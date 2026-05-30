# Cache & Buffer Layer Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply four internal performance wins in `lib/CacheAndBufferLayer.ts` from the spec at `docs/superpowers/specs/2026-05-28-cache-buffer-perf-design.md`. No public API change, no default change, no behavioral regression.

**Architecture:** All changes live in one file (`lib/CacheAndBufferLayer.ts`). Four self-contained wins applied in dependency order: (1) split `clone()` into `cloneIn`/`cloneOut` with `structuredClone` on the read path, (2) maintain a `_dirtyKeys: Set<string>` so `flush()` does not scan the entire LRU, (3) replace the constructor's `setInterval` with an on-demand `setTimeout`, (4) add a synchronous fast path in `get()` that skips the per-key lock on a cache hit with no in-flight writer. One new test file per win lives under `test/mock/`. The existing metrics test is adjusted because `get()` cache hits no longer increment `lockAcquires`/`lockReleases`.

**Tech Stack:** TypeScript 6 (ESM), vitest for tests, rolldown for bundling, pnpm. Node ≥24 (so `structuredClone` is available natively). Existing patterns: tests in `test/mock/` use the `mock` driver (an `EventEmitter`) to intercept driver-level calls; private fields are reached via `(db.db as any)._fieldName` because TypeScript `private` is not runtime-enforced.

---

## File Structure

**Modified:**

- `lib/CacheAndBufferLayer.ts` — all four wins. Existing structure (`LRU` class, `SelfContainedPromise`, `Database` class, `clone` function) is preserved; we rename `clone` to `cloneIn`, add `cloneOut`, add `_dirtyKeys` and `_flushTimer` fields, change `flush()`'s scan loop, replace the constructor's `setInterval`, and reshape `get()`.
- `test/mock/test_metrics.spec.ts` — three locations adjust expected metrics where `get()` (but not `getSub()`) on a cache hit no longer increments lock counters.

**Created:**

- `test/mock/test_dirty_set.spec.ts` — verifies the `_dirtyKeys` invariant under set/flush, re-set during in-flight write, and failed-write paths.
- `test/mock/test_lazy_flush.spec.ts` — verifies that an idle database has no scheduled timer, that `set()` arms the timer, and that `close()` clears it.
- `test/mock/test_lock_fast_path.spec.ts` — verifies that cache-hit `get()` does not acquire the per-key lock and that concurrent set+get serializes correctly while the lock is held.

**Not touched:** any database driver under `databases/`, `index.ts`, `lib/AbstractDatabase.ts`, `lib/logging.ts`. No `Settings` field is added or changed.

---

## Task 0: Baseline & Worktree Sanity

**Files:** none

- [ ] **Step 1: Run the full test suite to confirm a green baseline**

```bash
pnpm test
```

Expected: all tests pass. If anything fails on `main`, stop and report — do not attempt to implement on top of a red baseline.

- [ ] **Step 2: Run the type checker**

```bash
pnpm run ts-check
```

Expected: no output, exit 0.

- [ ] **Step 3: Confirm the spec file is present**

```bash
ls docs/superpowers/specs/2026-05-28-cache-buffer-perf-design.md
```

Expected: the file exists. If missing, stop — the plan is meaningless without the spec.

---

## Task 1: Win 1 — Split `clone()` into `cloneIn` / `cloneOut`

**Files:**

- Modify: `lib/CacheAndBufferLayer.ts` (rename `clone` → `cloneIn`, add `cloneOut`, rewire call sites)

The existing test `test/memory/test_tojson.spec.ts` is the safety net for the write path (`cloneIn`). No new test file is needed in this task — every call site we touch is already covered by an existing test (`test_lib.ts` for get/set/setSub/getSub/findKeys; `test_tojson.spec.ts` for toJSON semantics).

- [ ] **Step 1: Rename `clone` to `cloneIn` at its definition (no behavior change)**

Open `lib/CacheAndBufferLayer.ts`. At the bottom of the file (around line 608), find:

```ts
const clone = (obj: unknown, key = ''): unknown => {
```

Rename it to:

```ts
const cloneIn = (obj: unknown, key = ''): unknown => {
```

Inside the function body, the recursive calls to `clone(...)` become `cloneIn(...)`. There are three of them (the `toJSON` re-clone, the `Array.isArray` map, and the object-property loop).

- [ ] **Step 2: Add `cloneOut` immediately below `cloneIn`**

Add directly after `cloneIn`'s closing brace:

```ts
// Read-direction clone. The buffered value has already been processed by cloneIn (which strips
// toJSON methods) or by JSON.parse (which produces only plain JSON-safe values), so structuredClone
// will never see a function or other non-cloneable type here.
const cloneOut = (v: unknown): unknown =>
  v == null || typeof v !== "object" ? v : structuredClone(v);
```

- [ ] **Step 3: Rewire call sites — replace `clone(...)` with `cloneIn(...)` or `cloneOut(...)` per direction**

There are six call sites in the file. Replace each. Read direction → `cloneOut`. Write direction → `cloneIn`.

In `get` (around line 275):

```ts
return clone(v);
```

becomes:

```ts
return cloneOut(v);
```

In `findKeys` (around line 338):

```ts
return clone(keyValues) as string[];
```

becomes:

```ts
return cloneOut(keyValues) as string[];
```

In `findKeysPaged` — there are TWO `clone(...)` calls (around lines 371 and 380). Both become `cloneOut(...)`:

```ts
return clone(all.slice(start, start + options.limit)) as string[];
```

→ `return cloneOut(all.slice(start, start + options.limit)) as string[];`
and

```ts
return clone(keys) as string[];
```

→ `return cloneOut(keys) as string[];`

In `set` (line 389):

```ts
value = clone(value);
```

becomes:

```ts
value = cloneIn(value);
```

In `setSub` (line 438):

```ts
value = clone(value);
```

becomes:

```ts
value = cloneIn(value);
```

In `getSub` (line 511):

```ts
return clone(v);
```

becomes:

```ts
return cloneOut(v);
```

In `_write` (line 557 — the non-JSON fallback):

```ts
serialized = clone(entry.value) as string | null;
```

becomes:

```ts
serialized = cloneOut(entry.value) as string | null;
```

- [ ] **Step 4: Confirm no stray `clone(` references remain**

```bash
grep -n "[^a-zA-Z]clone(" lib/CacheAndBufferLayer.ts
```

Expected: empty output. Any hit means a call site was missed; fix it before continuing.

- [ ] **Step 5: Run the type checker**

```bash
pnpm run ts-check
```

Expected: no output, exit 0.

- [ ] **Step 6: Run the toJSON behavior test**

```bash
pnpm test test/memory/test_tojson.spec.ts
```

Expected: 4 passing tests (`no .toJSON method`, `direct`, `object property`, `array entry`).

- [ ] **Step 7: Run the full mock test suite**

```bash
pnpm test test/mock
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add lib/CacheAndBufferLayer.ts
git commit -m "perf(cache): use structuredClone on the read path

Split clone() into cloneIn (write path, preserves toJSON semantics)
and cloneOut (read path, delegates to V8-native structuredClone). The
cached value is always JSON-safe by construction, so the read-path
fast cloner does not need toJSON support."
```

---

## Task 2: Win 2 — Dirty-Key Set

**Files:**

- Create: `test/mock/test_dirty_set.spec.ts`
- Modify: `lib/CacheAndBufferLayer.ts` (add `_dirtyKeys` field, mutations in `_setLocked` and `markDone`, change `flush()` scan loop)

- [ ] **Step 1: Write the failing test for the `_dirtyKeys` invariant**

Create `test/mock/test_dirty_set.spec.ts`:

```ts
import * as ueberdb from "../../index";
import { ConsoleLogger } from "../../lib/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type MockSettings = { mock?: any };

const logger = new ConsoleLogger();

const dirtyKeys = (db: any): Set<string> => (db.db as any)._dirtyKeys;

describe(__filename, () => {
  let db: any = null;
  let mock: any = null;

  const createDb = async (wrapperSettings: Record<string, unknown> = {}) => {
    const settings: MockSettings = {};
    db = new ueberdb.Database("mock", settings, { json: false, ...wrapperSettings }, logger);
    await db.init();
    mock = settings.mock;
    mock.once("init", (cb: any) => cb());
  };

  afterEach(async () => {
    if (mock != null) {
      mock.removeAllListeners();
      mock.once("close", (cb: any) => cb());
      mock = null;
    }
    if (db != null) {
      await db.close();
      db = null;
    }
  });

  it("set() adds the key to _dirtyKeys; flush() drains it", async () => {
    // writeInterval=1e9 means the lazy flush timer effectively never fires; we drive flush manually.
    await createDb({ writeInterval: 1e9 });
    mock.on("set", (k: any, v: any, cb: any) => cb());
    const writeP = db.set("k", "v");
    // The buffered entry is dirty as soon as set() returns into the event loop.
    expect(dirtyKeys(db).has("k")).toBe(true);
    expect(dirtyKeys(db).size).toBe(1);
    await Promise.all([writeP, db.flush()]);
    expect(dirtyKeys(db).size).toBe(0);
  });

  it("re-set during an in-flight write keeps the key in _dirtyKeys", async () => {
    await createDb({ writeInterval: 1e9 });
    let releaseFirstWrite: (() => void) | null = null;
    const firstWriteSeen = new Promise<void>((resolve) => {
      mock.once("set", (k: any, v: any, cb: any) => {
        resolve();
        releaseFirstWrite = () => cb();
      });
    });
    const firstWriteP = db.set("k", "v1");
    const flushedP = db.flush();
    await firstWriteSeen;
    // While the first write is in flight, queue a second write to the same key.
    mock.once("set", (k: any, v: any, cb: any) => cb());
    const secondWriteP = db.set("k", "v2");
    // The key must remain in _dirtyKeys: the old in-flight entry is being written,
    // and a new dirty entry has taken its place in the buffer.
    expect(dirtyKeys(db).has("k")).toBe(true);
    // Release the first write; both promises must eventually resolve and _dirtyKeys must drain.
    releaseFirstWrite!();
    await Promise.all([firstWriteP, secondWriteP, flushedP]);
    // Drain any remaining dirty entry (the v2 write) — it may have been picked up by the
    // same flush() loop, but to be robust against scheduling we call flush() once more.
    await db.flush();
    expect(dirtyKeys(db).size).toBe(0);
  });

  it("failed write removes the key from _dirtyKeys and rejects the caller", async () => {
    await createDb({ writeInterval: 1e9 });
    mock.on("set", (k: any, v: any, cb: any) => cb(new Error("boom")));
    const writeP = db.set("k", "v");
    const flushedP = db.flush();
    await expect(writeP).rejects.toThrow("boom");
    await flushedP;
    expect(dirtyKeys(db).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the new test — confirm it fails because `_dirtyKeys` does not exist yet**

```bash
pnpm test test/mock/test_dirty_set.spec.ts
```

Expected: all three tests fail. Typical message: `TypeError: Cannot read properties of undefined (reading 'has')` because `(db.db as any)._dirtyKeys` is `undefined`.

- [ ] **Step 3: Add the `_dirtyKeys` field to the `Database` class**

In `lib/CacheAndBufferLayer.ts`, in the `Database` class field declarations (around line 161-164, near `_locks`), add:

```ts
  private readonly _dirtyKeys: Set<string> = new Set();
```

Place it immediately after the `_locks` field for locality.

- [ ] **Step 4: Add `_dirtyKeys.add(key)` in `_setLocked`**

In `_setLocked` (around line 407), after the line `this.buffer.set(key, entry);` (around line 420), add:

```ts
this._dirtyKeys.add(key);
```

Indented to match the surrounding block. This runs every time we mark an entry dirty.

- [ ] **Step 5: Change `markDone` to take `key` and conditionally remove from `_dirtyKeys`**

In `_write` (around line 539), the existing `markDone` closure is:

```ts
const markDone = (entry: CacheEntry, err?: Error | null): void => {
  if (entry.writingInProgress) {
    entry.writingInProgress = false;
    if (err != null) ++this.metrics.writesToDbFailed;
    ++this.metrics.writesToDbFinished;
  }
  entry.dirty!.done(err);
  entry.dirty = null;
};
```

Replace it with:

```ts
const markDone = (key: string, entry: CacheEntry, err?: Error | null): void => {
  if (entry.writingInProgress) {
    entry.writingInProgress = false;
    if (err != null) ++this.metrics.writesToDbFailed;
    ++this.metrics.writesToDbFinished;
  }
  // Reference-equality: only clear the dirty marker for THIS key if the entry currently
  // in the buffer is the same one we just wrote. If a re-set during the write replaced it
  // with a fresh dirty entry, the new entry must stay marked dirty.
  const current = this.buffer.get(key, false);
  if (current === entry) this._dirtyKeys.delete(key);
  entry.dirty!.done(err);
  entry.dirty = null;
};
```

- [ ] **Step 6: Update every `markDone` call site in `_write` to pass `key`**

There are four call sites in `_write`. Update each:

Around line 560 (inside the serialization try/catch in the `for (const [key, entry] of dirtyEntries)` loop):

```ts
markDone(entry, err as Error);
```

becomes:

```ts
markDone(key, entry, err as Error);
```

Around line 582 (inside `writeOneOp(op, entry)`):

```ts
markDone(entry, writeErr);
```

becomes:

```ts
markDone(op.key, entry, writeErr);
```

Around line 601 (the bulk-success branch):

```ts
if (success) entries.forEach((entry) => markDone(entry, null));
```

becomes:

```ts
if (success) {
  for (let i = 0; i < entries.length; i++) markDone(ops[i].key, entries[i], null);
}
```

(The `forEach`→`for` change is required because we now need the parallel `ops[i].key`.)

- [ ] **Step 7: Add `LRU.get(k, isUse = false)` support — already exists**

Verify that `LRU.get` already accepts an `isUse` parameter (it does; see line 113 of the current file). No change needed. The new code in `markDone` uses `this.buffer.get(key, false)` — confirm this compiles.

- [ ] **Step 8: Change `flush()`'s scan loop to iterate `_dirtyKeys`**

In `flush()` (around line 517), the inner block:

```ts
const dirtyEntries: [string, CacheEntry][] = [];
for (const entry of this.buffer) {
  if (entry[1].dirty && !entry[1].writingInProgress) {
    dirtyEntries.push(entry);
    if (this.settings.bulkLimit && dirtyEntries.length >= this.settings.bulkLimit) break;
  }
}
```

becomes:

```ts
const dirtyEntries: [string, CacheEntry][] = [];
for (const key of this._dirtyKeys) {
  const entry = this.buffer.get(key, false);
  if (!entry || !entry.dirty || entry.writingInProgress) continue;
  dirtyEntries.push([key, entry]);
  if (this.settings.bulkLimit && dirtyEntries.length >= this.settings.bulkLimit) break;
}
```

- [ ] **Step 9: Run the type checker**

```bash
pnpm run ts-check
```

Expected: no output, exit 0.

- [ ] **Step 10: Run the new dirty-set test — expect it to pass**

```bash
pnpm test test/mock/test_dirty_set.spec.ts
```

Expected: all three tests pass.

- [ ] **Step 11: Run the full mock test suite — confirm no regressions**

```bash
pnpm test test/mock
```

Expected: all green. The metrics test in particular must still pass — the `_dirtyKeys` work does not change any metrics-relevant behavior.

- [ ] **Step 12: Run the memory test suite — confirm `toJSON` and getSub still work**

```bash
pnpm test test/memory
```

Expected: all green.

- [ ] **Step 13: Commit**

```bash
git add lib/CacheAndBufferLayer.ts test/mock/test_dirty_set.spec.ts
git commit -m "perf(cache): track dirty keys in a Set so flush() does not scan the LRU

flush() previously iterated the entire LRU (default capacity 10 000) to
find entries with dirty != null. Maintain a Set<string> of currently
dirty keys, populated in _setLocked and drained in markDone with a
reference-equality guard so entry replacement during an in-flight write
is handled correctly."
```

---

## Task 3: Win 3 — Lazy Flush Scheduling

**Files:**

- Create: `test/mock/test_lazy_flush.spec.ts`
- Modify: `lib/CacheAndBufferLayer.ts` (remove `setInterval`, add `_flushTimer` + `_scheduleFlush`, update `close()` and `flush()` re-arm)

- [ ] **Step 1: Write the failing test for lazy flush scheduling**

Create `test/mock/test_lazy_flush.spec.ts`:

```ts
import * as ueberdb from "../../index";
import { ConsoleLogger } from "../../lib/logging";
import { afterEach, describe, expect, it } from "vitest";

type MockSettings = { mock?: any };

const logger = new ConsoleLogger();

const flushTimer = (db: any): unknown => (db.db as any)._flushTimer;

describe(__filename, () => {
  let db: any = null;
  let mock: any = null;

  const createDb = async (wrapperSettings: Record<string, unknown> = {}) => {
    const settings: MockSettings = {};
    db = new ueberdb.Database("mock", settings, { json: false, ...wrapperSettings }, logger);
    await db.init();
    mock = settings.mock;
    mock.once("init", (cb: any) => cb());
  };

  afterEach(async () => {
    if (mock != null) {
      mock.removeAllListeners();
      mock.once("close", (cb: any) => cb());
      mock = null;
    }
    if (db != null) {
      await db.close();
      db = null;
    }
  });

  it("idle database does not arm the flush timer", async () => {
    await createDb({ writeInterval: 50 });
    expect(flushTimer(db)).toBe(null);
    // Give the event loop a tick or two to confirm nothing schedules itself.
    await new Promise((r) => setTimeout(r, 30));
    expect(flushTimer(db)).toBe(null);
  });

  it("set() arms the timer; flush() leaves it null after draining", async () => {
    await createDb({ writeInterval: 1e9 }); // huge interval so the timer cannot fire during the test
    mock.on("set", (k: any, v: any, cb: any) => cb());
    const writeP = db.set("k", "v");
    // Synchronously after the set() call entered, the timer must be armed.
    expect(flushTimer(db)).not.toBe(null);
    await Promise.all([writeP, db.flush()]);
    // After an explicit flush() that drained everything, the timer must be null.
    expect(flushTimer(db)).toBe(null);
  });

  it("close() clears a pending flush timer", async () => {
    await createDb({ writeInterval: 1e9 });
    mock.on("set", (k: any, v: any, cb: any) => cb());
    const writeP = db.set("k", "v");
    expect(flushTimer(db)).not.toBe(null);
    await Promise.all([writeP, db.flush()]);
    // No timer pending now; close() must succeed without leaking handles.
    mock.once("close", (cb: any) => cb());
    await db.close();
    db = null; // prevent the afterEach close from double-closing
  });

  it("writeInterval=0 mode never arms the timer", async () => {
    await createDb({ writeInterval: 0 });
    mock.on("set", (k: any, v: any, cb: any) => cb());
    await db.set("k", "v");
    expect(flushTimer(db)).toBe(null);
  });
});
```

- [ ] **Step 2: Run the new test — confirm it fails because `_flushTimer` does not exist yet**

```bash
pnpm test test/mock/test_lazy_flush.spec.ts
```

Expected: all four tests fail. Typical failure: `_flushTimer` is `undefined`, not `null` — and the existing `setInterval` produces a non-null `flushInterval` instead.

- [ ] **Step 3: Remove the `flushInterval` field and replace with `_flushTimer`**

In `lib/CacheAndBufferLayer.ts`, find the field declaration (around line 164):

```ts
  private readonly flushInterval: ReturnType<typeof setInterval> | null;
```

Replace with:

```ts
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
```

(Drop `readonly` — we re-assign it; drop the inline initialization to `null` in the constructor since the field initializer takes care of it.)

- [ ] **Step 4: Delete the constructor's `setInterval` block**

Find (around line 217):

```ts
this.flushInterval =
  this.settings.writeInterval > 0
    ? setInterval(() => {
        void this.flush();
      }, this.settings.writeInterval)
    : null;
```

Delete the entire assignment. The constructor no longer sets up the timer.

- [ ] **Step 5: Add `_scheduleFlush` as a private method**

Add as a method inside the `Database` class, near the `_lock`/`_unlock` methods (around line 234, after `_unlock`):

```ts
  private _scheduleFlush(): void {
    if (this._flushTimer != null) return;
    if (this.settings.writeInterval <= 0) return;
    if (this._dirtyKeys.size === 0) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      void this.flush();
    }, this.settings.writeInterval);
    this._flushTimer.unref?.();
  }
```

- [ ] **Step 6: Call `_scheduleFlush` from `_setLocked`**

In `_setLocked`, immediately after the `this._dirtyKeys.add(key);` line added in Task 2 step 4, add:

```ts
this._scheduleFlush();
```

(Same indentation. The schedule call is a no-op if a timer is already armed or `writeInterval <= 0`.)

- [ ] **Step 7: Re-arm the timer at the end of `flush()` if dirty entries remain**

In `flush()` (around line 517), the function currently looks like:

```ts
  async flush(): Promise<void> {
    if (this._flushDone == null) {
      this._flushDone = (async () => {
        while (true) {
          while (this._flushPaused != null) await this._flushPaused;
          ...
        }
      })();
    }
    await this._flushDone;
    this._flushDone = null;
  }
```

Add a post-`_flushDone`-null re-arm so that any dirty entries left behind (in particular: an entry that was replaced during a write, so its newer counterpart is still dirty) get picked up:

```ts
  async flush(): Promise<void> {
    if (this._flushDone == null) {
      this._flushDone = (async () => {
        while (true) {
          while (this._flushPaused != null) await this._flushPaused;
          const dirtyEntries: [string, CacheEntry][] = [];
          for (const key of this._dirtyKeys) {
            const entry = this.buffer.get(key, false);
            if (!entry || !entry.dirty || entry.writingInProgress) continue;
            dirtyEntries.push([key, entry]);
            if (this.settings.bulkLimit && dirtyEntries.length >= this.settings.bulkLimit) break;
          }
          if (dirtyEntries.length === 0) return;
          await this._write(dirtyEntries);
        }
      })();
    }
    await this._flushDone;
    this._flushDone = null;
    if (this._dirtyKeys.size > 0) this._scheduleFlush();
  }
```

(The inner-loop body was already replaced in Task 2 step 8 — this step ADDS the trailing `if (this._dirtyKeys.size > 0) this._scheduleFlush();` line.)

- [ ] **Step 8: Update `close()` to clear the timer**

In `close()` (around line 260):

```ts
  async close(): Promise<void> {
    clearInterval(this.flushInterval ?? undefined);
    await this.flush();
    await this.wrappedDB!.close();
    this.wrappedDB = null;
  }
```

becomes:

```ts
  async close(): Promise<void> {
    if (this._flushTimer != null) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    await this.flush();
    await this.wrappedDB!.close();
    this.wrappedDB = null;
  }
```

- [ ] **Step 9: Run the type checker**

```bash
pnpm run ts-check
```

Expected: no output, exit 0. If TypeScript complains about `clearInterval`/`setInterval` import (it shouldn't — they are globals), check that you removed only the body but not necessary imports.

- [ ] **Step 10: Run the new lazy-flush test — expect it to pass**

```bash
pnpm test test/mock/test_lazy_flush.spec.ts
```

Expected: all four tests pass.

- [ ] **Step 11: Run the dirty-set test from Task 2 — must still pass**

```bash
pnpm test test/mock/test_dirty_set.spec.ts
```

Expected: all three tests pass. Win 3 should not have broken Win 2.

- [ ] **Step 12: Run the full mock suite**

```bash
pnpm test test/mock
```

Expected: all green. `test_flush.spec.ts` in particular exercises explicit `flush()` calls and must continue to work.

- [ ] **Step 13: Commit**

```bash
git add lib/CacheAndBufferLayer.ts test/mock/test_lazy_flush.spec.ts
git commit -m "perf(cache): replace setInterval with on-demand setTimeout

The constructor no longer arms a periodic timer. Instead, _setLocked
calls _scheduleFlush() when it makes an entry dirty; the timer fires
once, runs flush(), and clears itself. flush() re-arms the timer if
new dirty entries remain (entry replacement during write). Idle
databases consume zero timer ticks."
```

---

## Task 4: Win 4 — Lock Fast-Path in `get()`

**Files:**

- Create: `test/mock/test_lock_fast_path.spec.ts`
- Modify: `lib/CacheAndBufferLayer.ts` (reshape `get()`)
- Modify: `test/mock/test_metrics.spec.ts` (drop `lockAcquires`/`lockReleases` from expected deltas where they no longer apply — done AFTER the implementation so the test gets red exactly when the behavior changes)

This task changes externally observable metrics for `get()` cache hits: `lockAcquires` and `lockReleases` no longer increment on a cache hit. The metrics counters themselves remain in the public `Metrics` type — only the per-call increments change.

**Order matters:** the existing `test_metrics.spec.ts` will start failing the moment we change `get()`, so the test edit must be staged AFTER the implementation, not before. (Otherwise the edited test would be wrong-too-early: stripping `lockAcquires` from `expected` while the actual delta still contains it.)

- [ ] **Step 1: Write the failing test for the lock fast-path itself**

Create `test/mock/test_lock_fast_path.spec.ts`:

```ts
import * as ueberdb from "../../index";
import { ConsoleLogger } from "../../lib/logging";
import { afterEach, describe, expect, it } from "vitest";

type MockSettings = { mock?: any };

const logger = new ConsoleLogger();

describe(__filename, () => {
  let db: any = null;
  let mock: any = null;

  const createDb = async (wrapperSettings: Record<string, unknown> = {}) => {
    const settings: MockSettings = {};
    db = new ueberdb.Database("mock", settings, { json: false, ...wrapperSettings }, logger);
    await db.init();
    mock = settings.mock;
    mock.once("init", (cb: any) => cb());
  };

  afterEach(async () => {
    if (mock != null) {
      mock.removeAllListeners();
      mock.once("close", (cb: any) => cb());
      mock = null;
    }
    if (db != null) {
      await db.close();
      db = null;
    }
  });

  it("cache-hit get() does not acquire the per-key lock", async () => {
    await createDb({ writeInterval: 1e9 });
    // Prime the cache: a single set+flush is enough to populate the buffer with the value.
    mock.once("set", (k: any, v: any, cb: any) => cb());
    await Promise.all([db.set("k", "v"), db.flush()]);
    // After the write is finished, the buffer holds the value; the lock map is empty.
    const before = { ...db.metrics };
    const val = await db.get("k");
    expect(val).toBe("v");
    const after = db.metrics;
    expect(after.lockAcquires - before.lockAcquires).toBe(0);
    expect(after.lockReleases - before.lockReleases).toBe(0);
    expect(after.readsFromCache - before.readsFromCache).toBe(1);
  });

  it("cache-miss get() still acquires the lock", async () => {
    await createDb({ writeInterval: 1e9 });
    mock.once("get", (k: any, cb: any) => cb(null, "v"));
    const before = { ...db.metrics };
    const val = await db.get("k");
    expect(val).toBe("v");
    const after = db.metrics;
    expect(after.lockAcquires - before.lockAcquires).toBe(1);
    expect(after.lockReleases - before.lockReleases).toBe(1);
  });

  it("get() during a write-in-progress with the lock released returns the buffered value via fast path", async () => {
    await createDb({ writeInterval: 1e9 });
    let releaseWrite: (() => void) | null = null;
    const writeStarted = new Promise<void>((resolve) => {
      mock.once("set", (k: any, v: any, cb: any) => {
        resolve();
        releaseWrite = () => cb();
      });
    });
    const writeP = db.set("k", "v2");
    const flushedP = db.flush();
    await writeStarted;
    // At this moment: _write is awaiting the mock's callback. The per-key lock has been released
    // (set() releases the lock before awaiting entry.dirty). The buffer holds value 'v2'.
    // The fast path must apply.
    const before = { ...db.metrics };
    const val = await db.get("k");
    expect(val).toBe("v2");
    expect(db.metrics.lockAcquires - before.lockAcquires).toBe(0);
    expect(db.metrics.readsFromCache - before.readsFromCache).toBe(1);
    releaseWrite!();
    await Promise.all([writeP, flushedP]);
  });

  it("get() while a setter holds the lock takes the slow path", async () => {
    await createDb({ writeInterval: 1e9 });
    // Drive set() into the locked region by making _lock contend. We do this by setting
    // the same key twice in quick succession: the second set must await the first set's lock.
    mock.on("set", (k: any, v: any, cb: any) => cb());
    const set1 = db.set("k", "v1");
    const set2 = db.set("k", "v2");
    // While set2 is awaiting the lock, issue a get. It must take the slow path (lockAwaits increases).
    const before = { ...db.metrics };
    const getP = db.get("k");
    await Promise.all([set1, set2, db.flush(), getP]);
    expect(db.metrics.lockAwaits - before.lockAwaits).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run the new fast-path test — confirm the first test fails**

```bash
pnpm test test/mock/test_lock_fast_path.spec.ts
```

Expected: the first test (`cache-hit get() does not acquire the per-key lock`) fails — it expects `lockAcquires` delta of 0, but the current code increments it to 1. The other tests may or may not pass depending on timing; the critical signal is the first test failing.

- [ ] **Step 3: Implement the fast-path in `get()`**

In `lib/CacheAndBufferLayer.ts`, the current `get` (around line 267-276):

```ts
  async get(key: string): Promise<unknown> {
    let v: unknown;
    await this._lock(key);
    try {
      v = await this._getLocked(key);
    } finally {
      this._unlock(key);
    }
    return clone(v);
  }
```

Replace with:

```ts
  async get(key: string): Promise<unknown> {
    // Fast path: cache hit + no writer currently holding the per-key lock.
    // The check and the buffer read execute synchronously (no `await` until after the return),
    // so no concurrent set/setSub can interleave. cloneOut produces a consistent snapshot.
    if (!this._locks.has(key)) {
      const entry = this.buffer.get(key);
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
    // Slow path: cache miss or a writer holds the lock.
    let v: unknown;
    await this._lock(key);
    try {
      v = await this._getLocked(key);
    } finally {
      this._unlock(key);
    }
    return cloneOut(v);
  }
```

(Notice that `clone(v)` on the last line was already changed to `cloneOut(v)` in Task 1 step 3 — re-verify.)

- [ ] **Step 4: Run the type checker**

```bash
pnpm run ts-check
```

Expected: no output, exit 0.

- [ ] **Step 5: Run the new fast-path test — expect all four to pass**

```bash
pnpm test test/mock/test_lock_fast_path.spec.ts
```

Expected: 4 tests passing.

- [ ] **Step 6: Run the existing metrics test — expect it to fail because cache-hit `get()` no longer increments `lockAcquires`/`lockReleases`**

```bash
pnpm test test/mock/test_metrics.spec.ts
```

Expected: failures in the `get` → `cache hit` subcase and in `get` → `read of in-progress write`. The error message will be of the form `AssertionError: Expected {... lockAcquires: 1, lockReleases: 1, ...} to deeply equal {... no lockAcquires, no lockReleases ...}`. This is the cue to apply the metrics adjustment in the next step.

- [ ] **Step 7: Update `test/mock/test_metrics.spec.ts` to reflect the new metrics for `get` cache hits**

There are two locations to adjust. They are inside `describe('reads', ...)` (line 71) and inside the `tcs` array entry for `get` (which is at index 0).

**Location 1 — the inner subtc loop (around line 124):** Find the existing `it(subtc.name, ...)` block whose trailing line is:

```ts
assertMetricsDelta(before, db.metrics, subtc.wantMetrics);
```

Change that trailing line to:

```ts
// After perf refactor: get() cache hits no longer acquire the per-key lock.
// getSub() still locks because the slow path is the only path it uses.
const expected = { ...subtc.wantMetrics };
if (tc.name === "get" && subtc.cacheHit) {
  delete (expected as any).lockAcquires;
  delete (expected as any).lockReleases;
}
assertMetricsDelta(before, db.metrics, expected);
```

**Location 2 — the "read of in-progress write" test (around line 157):** Find:

```ts
        it('read of in-progress write', async () => {
          ...
          const before = {...db.metrics};
          await tc.f(key);
          assertMetricsDelta(before, db.metrics, {
            lockAcquires: 1,
            lockReleases: 1,
            reads: 1,
            readsFinished: 1,
            readsFromCache: 1,
          });
          ...
        });
```

Change the `assertMetricsDelta` block to:

```ts
const expected: Record<string, number> = {
  reads: 1,
  readsFinished: 1,
  readsFromCache: 1,
};
if (tc.name === "getSub") {
  expected.lockAcquires = 1;
  expected.lockReleases = 1;
}
assertMetricsDelta(before, db.metrics, expected);
```

The lock-contention test for `get` (around line 663-700) needs NO change: contention forces the slow path (because `_locks.has(key)` is true), so `lockAwaits: 1` still increments. Verify by reading the test that no other lock-related assertion fires.

- [ ] **Step 8: Run the metrics test — expect it to pass**

```bash
pnpm test test/mock/test_metrics.spec.ts
```

Expected: all green.

- [ ] **Step 9: Run all mock tests**

```bash
pnpm test test/mock
```

Expected: all green.

- [ ] **Step 10: Run the full test suite**

```bash
pnpm test
```

Expected: all green, including the in-memory `test/memory/*`, the speed-acceptance check in `test/lib/test_lib.ts`, and per-backend integration tests that are available locally. (Docker-driven integration tests will run only if the relevant containers are reachable; their absence is acceptable as long as the in-memory and mock suites pass.)

- [ ] **Step 11: Run lint + format check**

```bash
pnpm run lint
pnpm run format:check
```

Expected: no warnings/errors. If lint complains about unused variables, double-check that you didn't leave any stale references to `clone` (now `cloneIn`/`cloneOut`) or `flushInterval` (now `_flushTimer`).

- [ ] **Step 12: Commit**

```bash
git add lib/CacheAndBufferLayer.ts test/mock/test_metrics.spec.ts test/mock/test_lock_fast_path.spec.ts
git commit -m "perf(cache): lock-free fast path for get() cache hits

A cache-hit get() with no concurrent writer no longer constructs a
SelfContainedPromise or mutates the per-key lock Map. The check
(_locks.has(key)) and buffer read execute synchronously before the
first await, so no writer can interleave; structuredClone produces a
consistent snapshot. Adjusts test_metrics.spec.ts to reflect that
cache-hit get() (but not getSub()) no longer increments lockAcquires
or lockReleases."
```

---

## Task 5: Verification & PR-ready summary

**Files:** none (artifacts only)

- [ ] **Step 1: Capture the speed benchmark for the PR body**

Run the in-memory and mock variants of the speed test to capture before/after numbers. The speed table is printed by `test/lib/test_lib.ts`'s `speed is acceptable` block; the relevant rows come from `memory` and `mock` backends.

```bash
pnpm test test/memory/test_memory.spec.ts 2>&1 | tee /tmp/ueberdb-perf-after.log
```

(Repeat against `main` before this branch to get the baseline. Capture in `/tmp/ueberdb-perf-before.log`. Both logs go into the PR body as a side-by-side comparison.)

- [ ] **Step 2: Smoke-test against a real SQL backend (optional, if Docker is available)**

```bash
pnpm test test/sqlite
```

Expected: green. SQLite is the cheapest real-DB smoke test — no containers required.

- [ ] **Step 3: Confirm no file outside the planned set was modified**

```bash
git diff --stat main..HEAD
```

Expected: changed paths are exactly `lib/CacheAndBufferLayer.ts`, `test/mock/test_metrics.spec.ts`, `test/mock/test_dirty_set.spec.ts`, `test/mock/test_lazy_flush.spec.ts`, `test/mock/test_lock_fast_path.spec.ts`, `docs/superpowers/specs/2026-05-28-cache-buffer-perf-design.md`, and `docs/superpowers/plans/2026-05-28-cache-buffer-perf.md`. Anything else is scope creep — investigate before opening the PR.

- [ ] **Step 4: Review the commit log**

```bash
git log main..HEAD --oneline
```

Expected: four `perf(cache): ...` commits in order — clone split, dirty-key set, lazy flush, lock fast path — plus the two `docs:` commits for the spec and plan.

- [ ] **Step 5: Open the PR or hand off to a reviewer**

The PR description should reference the spec at `docs/superpowers/specs/2026-05-28-cache-buffer-perf-design.md` and include the before/after speed table captured in Step 1.

---

## Notes on Self-Review

This plan was checked against the spec:

- Win 1 (clone split) → Task 1 (8 steps).
- Win 2 (dirty-key set) → Task 2 (13 steps including new test file and 4 markDone call-site updates).
- Win 3 (lazy flush) → Task 3 (13 steps including new test file, removal of setInterval, addition of `_scheduleFlush`, and `close()` change).
- Win 4 (lock fast-path) → Task 4 (12 steps: write new fast-path test, watch it fail, implement, observe `test_metrics.spec.ts` go red on the cache-hit case, edit the metrics test to drop now-irrelevant lock counters from the expected delta for `get()` cache hits — `getSub()` still expects them).
- Spec's Testing section requirements (`test_dirty_set`, `test_lazy_flush`, `test_lock_fast_path`) → Tasks 2, 3, 4 each create their respective file.
- Spec's Edge Cases #2 (markDone order) → Task 2 step 5 places `_dirtyKeys.delete(key)` before `entry.dirty!.done(err)`.
- Spec's Edge Case #6 (writeInterval: 0) → Task 3 step 5's `_scheduleFlush` early-returns for `writeInterval <= 0`; Task 3 step 1's test `writeInterval=0 mode never arms the timer` covers it.
- Spec's "Microbenchmark artifacts" → Task 5 step 1.

No placeholders. No "TBD" / "implement appropriately". Each code-bearing step has the exact code to write.
