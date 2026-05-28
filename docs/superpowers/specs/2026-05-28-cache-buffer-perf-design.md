# Cache & Buffer Layer Performance Wins

**Date:** 2026-05-28
**Scope:** `lib/CacheAndBufferLayer.ts` only
**Type:** Internal refactor — no public API change, no default change, no behavioral regression for documented features (including `toJSON` semantics).

## Motivation

`lib/CacheAndBufferLayer.ts` sits on the hot path of every operation, regardless of which backend is in use. Profiling-by-inspection identified four cheap, well-isolated wins that compound:

1. A recursive `clone()` JS function runs on every `get`/`set`/`setSub`/`getSub`/`findKeys`. For the read direction the cache already holds a JSON-safe value, so `structuredClone` (a V8 native, available since Node ≥17 — the package requires ≥24) is strictly faster than the recursive walker.
2. `flush()` iterates the entire LRU buffer (default capacity 10 000) every `writeInterval` ms (default 100 ms) just to find dirty entries. For idle or read-heavy workloads, ~99% of those iterations find nothing.
3. The buffer is flushed via a `setInterval` that runs forever once init completes, even when the database has been idle for hours.
4. `get()` acquires and releases a per-key lock on every call — even on a guaranteed cache hit with no concurrent writer.

Each fix is internal and reviewable in isolation; together they cut sustained per-op CPU cost and eliminate idle-timer load. None of them changes settings, exported types, or method signatures.

## Non-Goals

- Driver-specific optimizations (mysql/postgres/mongodb hotspots) — out of scope for this spec.
- Worker-thread serialization for large JSON values.
- A byte-bounded cache (additional setting). 
- Pipelined or adaptive flush scheduling.
- Changing default `cache`, `writeInterval`, or `bulkLimit`.

## Architecture

All work happens in `lib/CacheAndBufferLayer.ts`. The four wins are listed below with their concrete implementation contract.

### Win 1 — Split `clone()` into `cloneIn` / `cloneOut`

**Problem.** The current `clone()` (lines 608-634) is a recursive deep-copy that resolves `toJSON` methods en route. It runs on every read AND every write. For deeply nested values it is meaningfully slower than the V8-native `structuredClone`. However, a naive swap to `structuredClone` would (a) skip `toJSON` resolution, breaking the documented behavior verified by `test/memory/test_tojson.spec.ts`, and (b) throw `DataCloneError` when the user passes a value containing a function (including `{toJSON: fn}`).

**Fix.** The write direction must keep `toJSON`-aware cloning. The read direction can safely use `structuredClone` because the cached value has already been through `cloneIn` (or `JSON.parse`, which is also JSON-safe).

```ts
const cloneIn = clone;  // existing function, renamed; toJSON semantics preserved

const cloneOut = (v: unknown): unknown =>
  v == null || typeof v !== 'object' ? v : structuredClone(v);
```

Call-site mapping:

| Site | Direction | Function |
|---|---|---|
| `set(key, value)` line 389 | Write (caller → cache) | `cloneIn` |
| `setSub(...)` line 438 | Write | `cloneIn` |
| `get(key)` line 275 | Read (cache → caller) | `cloneOut` |
| `getSub(...)` line 511 | Read | `cloneOut` |
| `findKeys` line 338 | Read | `cloneOut` |
| `findKeysPaged` line 371, 380 | Read | `cloneOut` |
| `_write` non-JSON fallback line 557 | Internal (cache → driver) | `cloneOut` |

The `_write` non-JSON fallback uses `cloneOut` because the entry value originated from a `cloneIn` call and is therefore JSON-safe.

### Win 2 — Dirty-Key Set

**Problem.** `flush()` (lines 522-528) iterates the entire `buffer` to find entries with `dirty != null`. With capacity 10 000 and one dirty entry, that's 10 000 Map iterations per scan.

**Fix.** Maintain a `Set<string>` of currently-dirty keys.

```ts
private readonly _dirtyKeys: Set<string> = new Set();
```

**Invariant:** `key ∈ _dirtyKeys` ⇔ `this.buffer.get(key, false)?.dirty != null`.

**Mutations:**

- In `_setLocked`, immediately after `this.buffer.set(key, entry)` (line 420): `this._dirtyKeys.add(key);`
- In `markDone(key, entry, err)` — signature gains `key` parameter — _before_ calling `entry.dirty!.done(err)`:
  ```ts
  const current = this.buffer.get(key, false);  // use isUse=false to avoid LRU reorder
  if (current === entry) this._dirtyKeys.delete(key);
  // else: entry was replaced by a fresh dirty entry; key remains in _dirtyKeys
  entry.dirty!.done(err);
  entry.dirty = null;
  ```
  Order matters: deleting from `_dirtyKeys` _before_ `done(err)` prevents a subtle race where the resolved caller schedules a new write that re-adds the key, only for our late `delete` to wipe it out.

- `LRU.get(k, isUse = true)`: already exists (line 113). We use `isUse=false` from `flush()` and `markDone` so we read the entry without reordering the LRU.

**`flush()` new loop:**

```ts
for (const key of this._dirtyKeys) {
  const entry = this.buffer.get(key, false);
  if (!entry || !entry.dirty || entry.writingInProgress) continue;
  dirtyEntries.push([key, entry]);
  if (this.settings.bulkLimit && dirtyEntries.length >= this.settings.bulkLimit) break;
}
```

The `writingInProgress` skip preserves existing semantics: in-flight entries stay in the set but are not re-issued.

### Win 3 — Lazy Flush Scheduling

**Problem.** `setInterval` in the constructor (lines 217-220) fires every `writeInterval` ms forever, regardless of whether anything is dirty.

**Fix.** Replace the `setInterval` with an on-demand `setTimeout` that is set when the first dirty entry is added and cleared after flushing.

```ts
private _flushTimer: ReturnType<typeof setTimeout> | null = null;

private _scheduleFlush(): void {
  if (this._flushTimer != null) return;
  if (this.settings.writeInterval <= 0) return;
  if (this._dirtyKeys.size === 0) return;
  this._flushTimer = setTimeout(() => {
    this._flushTimer = null;
    void this.flush();
  }, this.settings.writeInterval);
  this._flushTimer.unref?.();  // do not block process exit
}
```

**Call sites:**

- `_setLocked`, right after `_dirtyKeys.add(key)`: `this._scheduleFlush();`
- End of `flush()`'s outer wrapper, after the inner while-loop completes: if `this._dirtyKeys.size > 0` (some entries became dirty during `_write`), call `_scheduleFlush()`.

**`close()`:** replace `clearInterval(this.flushInterval)` with `if (this._flushTimer) clearTimeout(this._flushTimer);`. The `flushInterval` field is removed.

### Win 4 — Lock Fast-Path in `get()`

**Problem.** `get()` (line 267) acquires `_lock(key)` and releases it on every call, even when the key is already in the buffer and no concurrent write is happening. The lock acquisition allocates a `SelfContainedPromise` and performs two `Map` mutations per call.

**Fix.** Check synchronously whether a lock exists and the buffer is populated. If both checks pass, return the cloned value directly without locking.

```ts
async get(key: string): Promise<unknown> {
  if (!this._locks.has(key)) {
    const entry = this.buffer.get(key);  // LRU reorder is desired here (it's a real read)
    if (entry != null) {
      ++this.metrics.reads;
      ++this.metrics.readsFromCache;
      ++this.metrics.readsFinished;
      if (this.logger.isDebugEnabled()) {
        this.logger.debug(
          `GET    - ${key} - ${JSON.stringify(entry.value)} - ` +
            `from ${entry.dirty ? 'dirty buffer' : 'cache'}`,
        );
      }
      return cloneOut(entry.value);
    }
  }
  // Slow path — semantically identical to today.
  await this._lock(key);
  try { return cloneOut(await this._getLocked(key)); }
  finally { this._unlock(key); }
}
```

**Correctness argument.**

All mutating operations (`set`, `setSub`, and the internal write path during `_setLocked`'s synchronous prelude) execute under the per-key lock. JS is single-threaded; the fast path runs from `this._locks.has(key)` through `cloneOut(entry.value)` without yielding (no `await`s). Therefore one of these holds:

1. `_locks.has(key)` is false at the check → no writer is currently holding the lock; the fast path completes atomically and `structuredClone` produces a consistent snapshot. Any writer that starts after our check will not interleave with this `get` call.
2. `_locks.has(key)` is true at the check → fast path bails to slow path, which serializes via the lock exactly as today.

A reader that arrives "between" a writer's lock-release and its `_write` enqueue still sees a consistent buffer entry: `_setLocked`'s synchronous prelude (lines 410-420) updates the entry _before_ awaiting `entry.dirty`, so the buffer is current whenever the lock is not held.

The `setSub` mutation walk (lines 449-476) happens entirely under the lock; it is not interleaved with the fast path.

## Data Flow Comparison

### Cache-hit read, no contention

| Step | Today | After |
|---|---|---|
| 1 | `await _lock(key)` (Map.set + Promise alloc) | `_locks.has(key)` check |
| 2 | `_getLocked`: `buffer.get(key)` (Map.delete+set) | `buffer.get(key)` (Map.delete+set) |
| 3 | Read `entry.value` | Read `entry.value` |
| 4 | `_unlock(key)` (Map.delete + Promise.done) | _(skipped)_ |
| 5 | `clone(v)` — recursive walker | `cloneOut(v)` — `structuredClone` |

### Idle DB, default settings

| Per second | Today | After |
|---|---|---|
| `setInterval` ticks | 10 | 0 |
| Buffer iterations | 10 × cache size | 0 |
| Dirty entries inspected | usually 0 | 0 |

### Write under buffering

| Step | Today | After |
|---|---|---|
| `set(k, v)` | clone → lock → entry update → unlock | clone → lock → entry update + dirty-set add + schedule timer → unlock |
| Flush trigger | setInterval tick | one-shot setTimeout |
| Flush scan | iterate entire LRU | iterate `_dirtyKeys` only |

## Edge Cases

1. **Entry replacement during `writingInProgress`.** When `_setLocked` sees `entry.writingInProgress`, it allocates a fresh entry (line 414). The old entry's `markDone` will then find `buffer.get(key, false) !== entry` and leave the key in `_dirtyKeys`. The fresh entry's `_dirtyKeys.add(key)` is idempotent.

2. **`markDone` order.** Always: (a) reference-compare, conditionally delete from `_dirtyKeys`, (b) call `entry.dirty!.done(err)`, (c) null out `entry.dirty`. Reversing (a) and (b) would let a resolved caller re-enter and have its add wiped.

3. **`flush()` returning with remaining `writingInProgress` entries.** The new loop skips them. If a re-set during write left a new dirty entry, the outer while-loop in `flush()` picks it up on the next iteration. If `flush()` returns and `_dirtyKeys.size > 0`, the post-loop `_scheduleFlush()` re-arms the timer.

4. **`setSub` and the fast path.** `setSub` holds the lock through its mutation walk; `_locks.has(key)` is true during that window; the fast path declines. After `setSub` releases the lock the buffer is current and the fast path returns the post-mutation value (or a structurally cloned snapshot of it).

5. **`writeInterval: 0`.** `_setLocked` synchronously invokes `_write` (line 427). `_scheduleFlush` early-returns. `_dirtyKeys` is still maintained because `_setLocked` adds and `markDone` removes — `flush()` still works for explicit calls.

6. **`cache: 0`.** Buffer.set still happens in `_setLocked`. After write completes, `buffer.evictOld()` with capacity 0 removes everything; `_dirtyKeys` is empty by then (markDone cleared it). Consistent with today.

7. **Failed write.** `markDone` is called with `err != null`. `_dirtyKeys.delete(key)` still runs (under the reference-equality guard). The caller's `await p` rejects. The entry remains in the buffer with `dirty = null` and `value` equal to the last-attempted write — same as today.

8. **`structuredClone` on a value containing a function.** Cannot happen in `cloneOut` because the cache contains only `cloneIn`-output or `JSON.parse`-output, both of which are function-free. A defensive comment in the code documents this invariant.

9. **Circular references.** Today's recursive `clone()` would stack-overflow on circular structures (set side). `cloneIn` keeps that behavior. `cloneOut` (via `structuredClone`) tolerates them — strictly more permissive, no regression.

## Testing

### Existing tests that must remain green

- `test/memory/test_tojson.spec.ts` — verifies `toJSON` invocation; protected by `cloneIn`.
- `test/mock/test_flush.spec.ts`, `test_metrics.spec.ts`, `test_lru.spec.ts`, `test_bulk.spec.ts`, `test_setSub.spec.ts`, `test_findKeys.spec.ts`.
- All per-backend `*.spec.ts` files (only the contract on the wrapped DB is exercised; no driver code changes).
- `test/lib/test_lib.ts`'s `speed is acceptable` block — should pass with margin.

### New tests (all under `test/mock/`)

**`test_dirty_set.spec.ts`:**
- After `await db.set('k', v)` with `writeInterval > 0`, the internal `_dirtyKeys.size` is 0 immediately after `await` resolves (the await waits for the write to finish, so dirty is cleared). After `db.set` _before_ awaiting, `_dirtyKeys.size === 1` (use a paused mock driver).
- Re-set during in-flight write: pause the mock driver so the first set's `_write` hangs; call set again on the same key; verify `_dirtyKeys.size === 1` (idempotent add); release the first write; verify the old entry's `markDone` does _not_ clear the key (because buffer now holds the fresh entry); verify `metrics.writesObsoleted` increments.
- Failed write: mock driver throws; `_dirtyKeys` still cleared for that key; caller promise rejects.

**`test_lazy_flush.spec.ts`:**
- With `writeInterval: 100`, no `db.set` calls: wait 500 ms; verify `metrics.writesToDb === 0` and (via a test-only getter or `process._getActiveHandles().length` snapshot) no pending flush timer.
- With `writeInterval: 100`, one `db.set` to a paused mock: timer is armed; release; after 200 ms, write happened; timer is null again.
- `db.close()` clears the pending timer (no UnhandledHandle on exit).

**`test_lock_fast_path.spec.ts`:**
- Cache-hit `get`: prime the cache with `set`+await, then read `lockAcquires` metric, then call `get`. Acquires count does not increment.
- Concurrent set/get: hold a paused mock; issue `set('k', 'v2')` (does not await); issue `get('k')`; the get takes the slow path (because `_locks.has('k')` is true while set holds it); after releasing the mock, the get resolves with `'v2'`.

### Microbenchmark artifacts (non-CI)

- Run `pnpm test -- speed` locally on `memory` and `sqlite` backends pre- and post-change. Capture the per-op ms table from the existing `speed is acceptable` block. Paste both into the PR body.
- Optional `test/mock/bench_clone.bench.ts` using vitest's `bench()` to compare `cloneIn` vs `cloneOut` vs old `clone` on a synthetic Etherpad pad. Documentation only — no CI gate.

## Risks

- **Win 1 only:** Tiny risk of behavioral divergence if a caller stuffs a function into a deeply nested property and relies on it being silently dropped or thrown-on. Today's `clone()` throws ("Unable to copy obj!") for non-Date, non-Array, non-plain-object types except via the `instanceof Object` clause — which catches almost everything. `cloneIn` is the unchanged old function for write paths, so this is unaffected.
- **Win 2 only:** A bug in the reference-comparison in `markDone` could leak entries from `_dirtyKeys` (causing stale iteration) or wrongly clear them (causing missed flushes). The new tests in `test_dirty_set.spec.ts` cover both error modes.
- **Win 3 only:** A missed `_scheduleFlush()` call would leave dirty entries unwritten until the next explicit `flush()`. Covered by `test_lazy_flush.spec.ts`.
- **Win 4 only:** The correctness argument relies on the synchronous nature of the fast path. Any future edit that introduces an `await` between the lock check and the buffer read would break the guarantee. A code comment marks the synchronous region.

## Rollout

Single PR, all four wins together. The wins are mutually reinforcing (Win 2 enables Win 3 cheaply; Win 1 amortizes the cost of the buffer access in Win 4). Reverting any individual win is straightforward because the changes are localized to specific methods.
