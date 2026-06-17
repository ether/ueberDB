/**
 * 2011 Peter 'Pita' Martischka
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { promisify } from "node:util";
import type { Logger } from "./logging";

type BulkOp = {
  type: "set" | "remove";
  key: string;
  value: string | null;
};

type CacheEntry = {
  value: unknown;
  dirty: SelfContainedPromise | null;
  writingInProgress: boolean;
};

export type CacheSettings = {
  bulkLimit: number;
  cache: number;
  writeInterval: number;
  json: boolean;
  charset: string;
};

type InternalDB = {
  logger?: Logger;
  settings?: Partial<CacheSettings>;
  init(): Promise<void>;
  close(): Promise<void>;
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  findKeys(key: string, notKey?: string): Promise<string[]>;
  findKeysPaged(
    key: string,
    notKey: string | null | undefined,
    options: { limit: number; after?: string },
  ): Promise<string[]>;
  doBulk?(ops: BulkOp[]): Promise<void>;
};

type LegacyWrappedDB = {
  isAsync?: boolean;
  settings?: Partial<CacheSettings>;
  logger?: Logger;
  [key: string]: unknown;
};

export type Metrics = {
  lockAwaits: number;
  lockAcquires: number;
  lockReleases: number;
  reads: number;
  readsFailed: number;
  readsFinished: number;
  readsFromCache: number;
  readsFromDb: number;
  readsFromDbFailed: number;
  readsFromDbFinished: number;
  writes: number;
  writesFailed: number;
  writesFinished: number;
  writesObsoleted: number;
  writesToDb: number;
  writesToDbFailed: number;
  writesToDbFinished: number;
  writesToDbRetried: number;
};

const defaultSettings: CacheSettings = {
  bulkLimit: 0,
  cache: 10000,
  writeInterval: 100,
  json: true,
  charset: "utf8mb4",
};

export class LRU {
  private _capacity: number;
  private _evictable: (k: string, v: CacheEntry) => boolean;
  private _cache: Map<string, CacheEntry>;

  /**
   * @param evictable Optional predicate that dictates whether it is permissable to evict the entry
   *     if it is old and the cache is over capacity. Warning: Non-evictable entries can cause the
   *     cache to go over capacity.
   */
  constructor(capacity: number, evictable: (k: string, v: CacheEntry) => boolean = () => true) {
    this._capacity = capacity;
    this._evictable = evictable;
    this._cache = new Map();
  }

  [Symbol.iterator](): IterableIterator<[string, CacheEntry]> {
    return this._cache.entries();
  }

  get(k: string, isUse = true): CacheEntry | undefined {
    if (!this._cache.has(k)) return undefined;
    const v = this._cache.get(k)!;
    if (isUse) {
      this._cache.delete(k);
      this._cache.set(k, v);
    }
    return v;
  }

  set(k: string, v: CacheEntry): void {
    this._cache.delete(k);
    this._cache.set(k, v);
    this.evictOld();
  }

  evictOld(): void {
    for (const [k, v] of this._cache.entries()) {
      if (this._cache.size <= this._capacity) break;
      if (!this._evictable(k, v)) continue;
      this._cache.delete(k);
    }
  }
}

// Same as Promise<void> but with a `done` callback that resolves/rejects it.
class SelfContainedPromise extends Promise<void> {
  done!: (err?: Error | null) => void;

  constructor(
    executor: ((resolve: () => void, reject: (reason?: unknown) => void) => void) | null = null,
  ) {
    let done!: (err?: Error | null) => void;
    super((resolve, reject) => {
      done = (err) => (err != null ? reject(err) : resolve());
      executor?.(resolve, reject);
    });
    this.done = done;
  }
}

export class Database {
  private wrappedDB: InternalDB | null;
  public logger: Logger;
  public readonly settings: Readonly<CacheSettings>;
  private readonly buffer: LRU;
  private _flushPaused: SelfContainedPromise | null = null;
  private _flushPausedCount = 0;
  private readonly _locks: Map<string, SelfContainedPromise> = new Map();
  private readonly _dirtyKeys: Set<string> = new Set();
  private _flushDone: Promise<void> | null = null;
  public metrics: Metrics;
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  private _keepAlive: ReturnType<typeof setInterval> | null = null;

  constructor(
    wrappedDB: LegacyWrappedDB,
    settings: Partial<CacheSettings> | null | undefined,
    logger: Logger,
  ) {
    if (wrappedDB.isAsync) {
      this.wrappedDB = wrappedDB as unknown as InternalDB;
    } else {
      const promisified: Partial<InternalDB> = {};
      for (const fn of [
        "close",
        "doBulk",
        "findKeys",
        "findKeysPaged",
        "get",
        "init",
        "remove",
        "set",
      ] as const) {
        const f = wrappedDB[fn];
        if (typeof f !== "function") continue;
        (promisified as Record<string, unknown>)[fn] = promisify(
          (f as (...args: unknown[]) => unknown).bind(wrappedDB),
        );
      }
      this.wrappedDB = promisified as InternalDB;
    }
    this.logger = logger;

    this.settings = Object.freeze({
      ...defaultSettings,
      ...(wrappedDB.settings ?? {}),
      ...(settings ?? {}),
    });

    this.buffer = new LRU(this.settings.cache, (k, v) => !v.dirty && !v.writingInProgress);

    this.metrics = {
      lockAwaits: 0,
      lockAcquires: 0,
      lockReleases: 0,
      reads: 0,
      readsFailed: 0,
      readsFinished: 0,
      readsFromCache: 0,
      readsFromDb: 0,
      readsFromDbFailed: 0,
      readsFromDbFinished: 0,
      writes: 0,
      writesFailed: 0,
      writesFinished: 0,
      writesObsoleted: 0,
      writesToDb: 0,
      writesToDbFailed: 0,
      writesToDbFinished: 0,
      writesToDbRetried: 0,
    };

    // Keep the host process's event loop anchored for as long as this Database is open. For years
    // the cache layer's always-on, *referenced* flush `setInterval` did this implicitly, and
    // consumers (notably Etherpad) rely on it: during the window between "DB initialised" and "HTTP
    // server listening" nothing else holds the loop open, so without an anchor the process exits 0
    // *mid-startup*. The lazily-armed flush timer (_scheduleFlush) is `.unref()`'d and only exists
    // while there are dirty keys, so it cannot fill this role. This dedicated referenced timer does;
    // it effectively never fires (max timer delay) so it costs nothing, and close() releases it.
    this._keepAlive = setInterval(() => {}, 2 ** 31 - 1);
  }

  private async _lock(key: string): Promise<void> {
    while (true) {
      const l = this._locks.get(key);
      if (l == null) break;
      ++this.metrics.lockAwaits;
      await l;
    }
    ++this.metrics.lockAcquires;
    this._locks.set(key, new SelfContainedPromise());
  }

  private _unlock(key: string): void {
    ++this.metrics.lockReleases;
    this._locks.get(key)!.done();
    this._locks.delete(key);
  }

  private _scheduleFlush(): void {
    if (this._flushTimer != null) return;
    // A flush is already in progress. Arming a timer now would leave a stray timer behind if
    // that flush drains the keys this write just dirtied: flush() iterates _dirtyKeys live and
    // re-arms via its own postlude only when keys actually remain. Let it own the rescheduling.
    if (this._flushDone != null) return;
    if (this.settings.writeInterval <= 0) return;
    if (this._dirtyKeys.size === 0) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      void this.flush();
    }, this.settings.writeInterval);
    this._flushTimer.unref?.();
  }

  private _cancelFlushTimer(): void {
    if (this._flushTimer != null) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
  }

  // Block flush() until _resumeFlush() is called. This ensures a flush() called after a write in
  // the same macro/microtask sees the buffered write.
  private _pauseFlush(): void {
    if (this._flushPaused == null) {
      this._flushPaused = new SelfContainedPromise();
      this._flushPausedCount = 0;
    }
    ++this._flushPausedCount;
  }

  private _resumeFlush(): void {
    if (--this._flushPausedCount > 0) return;
    this._flushPaused!.done();
    this._flushPaused = null;
  }

  async init(): Promise<void> {
    await this.wrappedDB!.init();
  }

  async close(): Promise<void> {
    this._cancelFlushTimer();
    if (this._keepAlive != null) {
      clearInterval(this._keepAlive);
      this._keepAlive = null;
    }
    await this.flush();
    await this.wrappedDB!.close();
    this.wrappedDB = null;
  }

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
              `from ${entry.dirty ? "dirty buffer" : "cache"}`,
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

  private async _getLocked(key: string): Promise<unknown> {
    ++this.metrics.reads;
    try {
      const entry = this.buffer.get(key);
      if (entry != null) {
        ++this.metrics.readsFromCache;
        if (this.logger.isDebugEnabled()) {
          this.logger.debug(
            `GET    - ${key} - ${JSON.stringify(entry.value)} - ` +
              `from ${entry.dirty ? "dirty buffer" : "cache"}`,
          );
        }
        return entry.value;
      }

      let value: unknown;
      ++this.metrics.readsFromDb;
      try {
        value = await this.wrappedDB!.get(key);
      } catch (err) {
        ++this.metrics.readsFromDbFailed;
        throw err;
      } finally {
        ++this.metrics.readsFromDbFinished;
      }

      if (this.settings.json) {
        try {
          value = value != null ? JSON.parse(value as string) : null;
        } catch (err) {
          this.logger.error(`JSON-PROBLEM:${value as string}`);
          throw err;
        }
      }

      if (this.settings.cache > 0) {
        this.buffer.set(key, { value, dirty: null, writingInProgress: false });
      }

      if (this.logger.isDebugEnabled()) {
        this.logger.debug(`GET    - ${key} - ${JSON.stringify(value)} - from database `);
      }

      return value;
    } catch (err) {
      ++this.metrics.readsFailed;
      throw err;
    } finally {
      ++this.metrics.readsFinished;
    }
  }

  async findKeys(key: string, notKey?: string): Promise<string[]> {
    await this.flush();
    const keyValues = await this.wrappedDB!.findKeys(key, notKey);
    if (this.logger.isDebugEnabled()) {
      this.logger.debug(
        `GET    - ${key}-${notKey} - ${JSON.stringify(keyValues)} - from database `,
      );
    }
    return cloneOut(keyValues) as string[];
  }

  async findKeysPaged(
    key: string,
    notKey: string | null | undefined,
    options: { limit: number; after?: string },
  ): Promise<string[]> {
    // Reject invalid limits at the wrapper boundary so behaviour matches the
    // native sql backends (which throw) — without this, an invalid limit hits
    // .slice() in the fallback path and silently returns an empty page, which
    // can hang a `while (page.length === limit)` paging loop.
    if (!options || !Number.isInteger(options.limit) || options.limit <= 0) {
      throw new Error("findKeysPaged requires a positive integer limit");
    }
    await this.flush();
    // Some legacy callback-only backends (e.g. mock_db) don't implement the
    // paged variant. Fall back to findKeys + JS-side slicing so the API is
    // available everywhere, even though the OOM-mitigation benefit is lost.
    if (typeof this.wrappedDB!.findKeysPaged !== "function") {
      const all = (await this.wrappedDB!.findKeys(key, notKey ?? undefined)) || [];
      all.sort();
      const start =
        options.after == null
          ? 0
          : (() => {
              let lo = 0,
                hi = all.length;
              while (lo < hi) {
                const mid = (lo + hi) >>> 1;
                if (all[mid] <= options.after!) lo = mid + 1;
                else hi = mid;
              }
              return lo;
            })();
      return cloneOut(all.slice(start, start + options.limit)) as string[];
    }
    const keys = await this.wrappedDB!.findKeysPaged(key, notKey, options);
    if (this.logger.isDebugEnabled()) {
      this.logger.debug(
        `GET    - ${key}-${notKey} (paged limit=${options.limit} after=${options.after ?? ""}) ` +
          `- ${JSON.stringify(keys)} - from database `,
      );
    }
    return cloneOut(keys) as string[];
  }

  async remove(key: string): Promise<void> {
    if (this.logger.isDebugEnabled()) this.logger.debug(`DELETE - ${key} - from database `);
    await this.set(key, null);
  }

  async set(key: string, value: unknown): Promise<void> {
    value = cloneIn(value);
    let p!: Promise<void>;
    this._pauseFlush();
    try {
      await this._lock(key);
      try {
        p = this._setLocked(key, value);
      } finally {
        this._unlock(key);
      }
    } finally {
      this._resumeFlush();
    }
    await p;
  }

  // Must not use `await` before buffering the entry — the caller unlocks the record immediately
  // after this returns, so the entry must be in the buffer before any await.
  private async _setLocked(key: string, value: unknown): Promise<void> {
    ++this.metrics.writes;
    try {
      let entry = this.buffer.get(key);
      // If a write is already in progress for this key, create a new entry rather than updating
      // the existing one — otherwise entry.dirty would resolve prematurely.
      if (!entry || entry.writingInProgress) {
        entry = { value: undefined, dirty: null, writingInProgress: false };
      } else if (entry.dirty) {
        ++this.metrics.writesObsoleted;
      }
      entry.value = value;
      if (!entry.dirty) entry.dirty = new SelfContainedPromise();
      this.buffer.set(key, entry);
      this._dirtyKeys.add(key);
      this._scheduleFlush();
      const buffered = this.settings.writeInterval > 0;
      if (this.logger.isDebugEnabled()) {
        this.logger.debug(
          `SET    - ${key} - ${JSON.stringify(value)} - to ${buffered ? "buffer" : "database"}`,
        );
      }
      if (!buffered) void this._write([[key, entry]]);
      await entry.dirty;
    } catch (err) {
      ++this.metrics.writesFailed;
      throw err;
    } finally {
      ++this.metrics.writesFinished;
    }
  }

  async setSub(key: string, sub: string[], value: unknown): Promise<void> {
    value = cloneIn(value);
    if (this.logger.isDebugEnabled()) {
      this.logger.debug(`SETSUB - ${key}${JSON.stringify(sub)} - ${JSON.stringify(value)}`);
    }
    let p!: Promise<void>;
    this._pauseFlush();
    try {
      await this._lock(key);
      try {
        let base: { fullValue: unknown };
        try {
          const fullValue = await this._getLocked(key);
          base = { fullValue };
          const ptr: { obj: Record<string, unknown>; prop: string } = {
            obj: base as Record<string, unknown>,
            prop: "fullValue",
          };
          for (let i = 0; i < sub.length; i++) {
            if (sub[i] === "__proto__") {
              throw new Error("Modifying object prototype is not supported for security reasons");
            }
            let o = ptr.obj[ptr.prop];
            if (o == null) ptr.obj[ptr.prop] = o = {};
            if (typeof o !== "object") {
              throw new TypeError(
                `Cannot set property ${JSON.stringify(sub[i])} on non-object ` +
                  `${JSON.stringify(o)} (key: ${JSON.stringify(key)} ` +
                  `value in db: ${JSON.stringify(fullValue)} ` +
                  `sub: ${JSON.stringify(sub.slice(0, i + 1))})`,
              );
            }
            ptr.obj = ptr.obj[ptr.prop] as Record<string, unknown>;
            ptr.prop = sub[i];
          }
          if (value == null) {
            delete ptr.obj[ptr.prop];
          } else {
            ptr.obj[ptr.prop] = value;
          }
        } catch (err) {
          ++this.metrics.writes;
          ++this.metrics.writesFailed;
          ++this.metrics.writesFinished;
          throw err;
        }
        p = this._setLocked(key, base.fullValue);
      } finally {
        this._unlock(key);
      }
    } finally {
      this._resumeFlush();
    }
    await p;
  }

  async getSub(key: string, sub: string[]): Promise<unknown> {
    await this._lock(key);
    try {
      let v = await this._getLocked(key);
      for (const k of sub) {
        if (
          typeof v !== "object" ||
          (v != null && !Object.prototype.hasOwnProperty.call(v, k)) ||
          k === "__proto__"
        ) {
          v = null;
        }
        if (v == null) break;
        v = (v as Record<string, unknown>)[k];
      }
      if (this.logger.isDebugEnabled()) {
        this.logger.debug(`GETSUB - ${key}${JSON.stringify(sub)} - ${JSON.stringify(v)}`);
      }
      return cloneOut(v);
    } finally {
      this._unlock(key);
    }
  }

  async flush(): Promise<void> {
    // Cancel any pending lazy-flush timer — we are doing the work right now.
    this._cancelFlushTimer();
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

  private async _write(dirtyEntries: [string, CacheEntry][]): Promise<void> {
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

    const ops: BulkOp[] = [];
    const entries: CacheEntry[] = [];
    for (const [key, entry] of dirtyEntries) {
      let serialized: string | null;
      try {
        if (this.settings.json && entry.value != null) {
          serialized = JSON.stringify(entry.value);
        } else {
          serialized = cloneOut(entry.value) as string | null;
        }
      } catch (err) {
        markDone(key, entry, err as Error);
        continue;
      }
      entry.writingInProgress = true;
      ops.push({ type: serialized == null ? "remove" : "set", key, value: serialized });
      entries.push(entry);
    }
    if (ops.length === 0) return;

    this.metrics.writesToDb += ops.length;

    const writeOneOp = async (op: BulkOp, entry: CacheEntry): Promise<void> => {
      let writeErr: Error | null = null;
      try {
        if (op.type === "remove") {
          await this.wrappedDB!.remove(op.key);
        } else {
          await this.wrappedDB!.set(op.key, op.value!);
        }
      } catch (err) {
        writeErr = err instanceof Error ? err : new Error(String(err));
      }
      markDone(op.key, entry, writeErr);
    };

    if (ops.length === 1) {
      await writeOneOp(ops[0], entries[0]);
    } else if (typeof this.wrappedDB!.doBulk !== "function") {
      await Promise.all(ops.map(async (op, i) => writeOneOp(op, entries[i])));
    } else {
      let success = false;
      try {
        await this.wrappedDB!.doBulk(ops);
        success = true;
      } catch (err) {
        this.logger.error(
          `Bulk write of ${ops.length} ops failed, retrying individually: ${(err as Error).stack ?? String(err)}`,
        );
        this.metrics.writesToDbRetried += ops.length;
        await Promise.all(ops.map(async (op, i) => writeOneOp(op, entries[i])));
      }
      if (success) {
        for (let i = 0; i < entries.length; i++) markDone(ops[i].key, entries[i], null);
      }
    }
    // Evict here to enforce cache = 0 semantics (reads must not hit cache after write completes).
    this.buffer.evictOld();
  }
}

const cloneIn = (obj: unknown, key = ""): unknown => {
  if (obj == null || typeof obj !== "object") return obj;

  if (typeof (obj as Record<string, unknown>).toJSON === "function") {
    return cloneIn((obj as { toJSON(k: string): unknown }).toJSON(key));
  }

  if (obj instanceof Date) {
    const copy = new Date();
    copy.setTime(obj.getTime());
    return copy;
  }

  if (Array.isArray(obj)) {
    return obj.map((item, i) => cloneIn(item, String(i)));
  }

  if (obj instanceof Object) {
    const copy: Record<string, unknown> = {};
    for (const attr of Object.keys(obj)) {
      copy[attr] = cloneIn((obj as Record<string, unknown>)[attr], attr);
    }
    return copy;
  }

  throw new Error("Unable to copy obj! Its type isn't supported.");
};

// Read-direction clone. The buffered value has typically been processed by cloneIn (which strips
// toJSON methods at the root and resolves them recursively) or by JSON.parse (always JSON-safe).
// Functions inside cloneIn-output objects ARE preserved as-is, so structuredClone may still throw
// DataCloneError. Fall back to cloneIn (which preserves non-cloneable values by passing them
// through unchanged) to keep parity with the pre-refactor clone() semantics.
const cloneOut = (v: unknown): unknown => {
  if (v == null || typeof v !== "object") return v;
  try {
    return structuredClone(v);
  } catch {
    return cloneIn(v);
  }
};

export const exportedForTesting = { LRU };
