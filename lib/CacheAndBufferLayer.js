'use strict';
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

/**
 * This module is made for the case, you want to use a SQL-Based Databse or a KeyValue Database that
 * can only save strings(and no objects), as a JSON KeyValue Store.
 *
 * The idea of the dbWrapper is to provide following features:
 *
 *   * automatic JSON serialize/deserialize to abstract that away from the database driver and the
 *     module user.
 *   * cache reads. A amount of KeyValues are hold in the memory, so that reading is faster.
 *   * Buffer DB Writings. Sets and deletes should be buffered to make them in a setted interval
 *     with a bulk. This reduces the overhead of database transactions and makes the database
 *     faster. But there is also a danger to loose data integrity, to keep that, we should provide a
 *     flush function.
 *
 * All Features can be disabled or configured. The Wrapper provides default settings that can be
 * overwriden by the driver and by the module user.
 */

const util = require('util');

/**
 * Cache with Least Recently Used eviction policy.
 */
class LRU {
  /**
   * @param evictable Optional predicate that dictates whether it is permissable to evict the entry
   *     if it is old and the cache is over capacity. The predicate is passed two arguments (key,
   *     value). If no predicate is provided, all entries are evictable. Warning: Non-evictable
   *     entries can cause the cache to go over capacity. If the number of non-evictable entries is
   *     greater than or equal to the capacity, all new evictable entries will be evicted
   *     immediately.
   */
  constructor(capacity, evictable = (k, v) => true) {
    this._capacity = capacity;
    this._evictable = evictable;
    this._cache = new Map();
  }

  /**
   * The entries accessed via this iterator are not considered to have been "used" (for purposes of
   * determining least recently used).
   */
  [Symbol.iterator]() {
    return this._cache.entries();
  }

  /**
   * @param isUse Optional boolean indicating whether this get() should be considered a "use" of the
   *     entry (for determining least recently used). Defaults to true.
   * @returns undefined if there is no entry matching the given key.
   */
  get(k, isUse = true) {
    if (!this._cache.has(k)) return;
    const v = this._cache.get(k);
    if (isUse) {
      // Mark this entry as the most recently used entry.
      this._cache.delete(k);
      this._cache.set(k, v);
    }
    return v;
  }

  /**
   * Adds or updates an entry in the cache. This marks the entry as the most recently used entry.
   */
  set(k, v) {
    this._cache.delete(k); // Make sure this entry is marked as the most recently used entry.
    this._cache.set(k, v);
    this.evictOld();
  }

  /**
   * Evicts the oldest evictable entries until the number of entries is equal to or less than the
   * cache's capacity. This method is automatically called by set(). Call this if you need to evict
   * newly evictable entries before the next call to set().
   */
  evictOld() {
    // ES Map objects iterate in insertion order, so the first items are the ones that have been
    // accessed least recently.
    for (const [k, v] of this._cache.entries()) {
      if (this._cache.size <= this._capacity) break;
      if (!this._evictable(k, v)) continue;
      this._cache.delete(k);
    }
  }
}

// Same as Promise but with a `done` property set to a Node-style callback that resolves/rejects the
// Promise.
class SelfContainedPromise extends Promise {
  constructor(executor = null) {
    let done;
    super((resolve, reject) => {
      done = (err, val) => err != null ? reject(err) : resolve(val);
      if (executor != null) executor(resolve, reject);
    });
    this.done = done;
  }
}

const defaultSettings =
{
  // Maximum number of operations that can be passed to the wrapped database's doBulk() method.
  // Falsy means no limit. EXPERIMENTAL.
  bulkLimit: 0,
  // the number of elements that should be cached. To Disable cache just set it to zero
  cache: 10000,
  // the interval in ms the wrapper writes to the database. To Disable interval writes just set it
  // to zero
  writeInterval: 100,
  // a flag if the data sould be serialized/deserialized to json
  json: true,
  // use utf8mb4 as default
  charset: 'utf8mb4',
};

exports.Database = class {
  /**
   * @param wrappedDB The Database that should be wrapped
   * @param settings (optional) The settings that should be applied to the wrapper
   */
  constructor(wrappedDB, settings, logger) {
    // wrappedDB.isAsync is a temporary boolean that will go away once we have migrated all of the
    // database drivers from callback-based methods to async methods.
    if (wrappedDB.isAsync) {
      this.wrappedDB = wrappedDB;
    } else {
      this.wrappedDB = {};
      for (const fn of ['close', 'doBulk', 'findKeys', 'get', 'init', 'remove', 'set']) {
        const f = wrappedDB[fn];
        if (typeof f !== 'function') continue;
        this.wrappedDB[fn] = util.promisify(f.bind(wrappedDB));
      }
    }
    this.logger = logger;

    this.settings = Object.freeze({
      ...defaultSettings,
      ...(wrappedDB.settings || {}),
      ...(settings || {}),
    });

    // The key is the database key. The value is an object with the following properties:
    //   - value: The entry's value.
    //   - dirty: If the value has not yet been written, this is a Promise that will resolve once
    //     the write to the underlying database returns. If the value has been written this is null.
    //   - writingInProgress: Boolean that if true indicates that the value has been sent to the
    //     underlying database and we are awaiting commit.
    this.buffer = new LRU(this.settings.cache, (k, v) => !v.dirty && !v.writingInProgress);

    // Either null if flushing is currently allowed, or a Promise that will resolve when it is OK to
    // start flushing. The Promise has a `count` property that tracks the number of operations that
    // are currently preventing flush() from running.
    this._flushPaused = null;

    // Maps database key to a Promise that is resolved when the record is unlocked.
    this._locks = new Map();

    this.metrics = {
      // Count of times a database operation had to wait for the release of a record lock.
      lockAwaits: 0,
      // Count of times a record was locked.
      lockAcquires: 0,
      // Count of times a record was unlocked.
      lockReleases: 0,

      // Count of read operations (number of times `get()`, `getSub()`, and `setSub()` were called).
      // This minus `readsFinished` is the number of currently pending read operations.
      reads: 0,
      // Count of times a read operation failed, including JSON parsing errors. This divided by
      // `readsFinished` is the overall read error rate.
      readsFailed: 0,
      // Count of completed (successful or failed) read operations.
      readsFinished: 0,
      // Count of read operations that were satisfied from in-memory state (including the write
      // buffer).
      readsFromCache: 0,
      // Count of times the database was queried for a value. This minus `readsFromDbFinished` is
      // the number of in-progress reads.
      readsFromDb: 0,
      // Count of times the database failed to return a value. This does not include JSON parsing
      // errors.
      readsFromDbFailed: 0,
      // Count of completed (successful or failed) value reads from the database. This plus
      // `readsFromCache` equals `readsFinished`.
      readsFromDbFinished: 0,

      // Count of write operations (number of times `remove()`, `set()`, or `setSub()` was called)
      // regardless of whether the value actually changed. This minus `writesFinished` is the
      // current number of pending write operations.
      writes: 0,
      // Count of times a write operation failed, including JSON serialization errors. This divided
      // by `writesFinished` is the overall write error rate.
      writesFailed: 0,
      // Count of completed (successful or failed) write operations.
      writesFinished: 0,
      // Count of times a pending write operation was not sent to the underlying database because a
      // call to `remove()`, `set()`, or `setSub()` superseded the write, rendering it unnecessary.
      writesObsoleted: 0,
      // Count of times a value was sent to the underlying database, including record deletes but
      // excluding retries. This minus `writesToDbFinished` is the number of in-progress writes.
      writesToDb: 0,
      // Count of times ueberDB failed to write a change to the underlying database, including
      // failed record deletes. This does not include JSON serialization errors or write errors that
      // later succeeded thanks to a retry by ueberDB.
      writesToDbFailed: 0,
      // Count of completed (successful or failed) value writes to the database. This plus
      // `writesObsoleted` equals `writesFinished`.
      writesToDbFinished: 0,
      // Count of times a write operation was retried.
      writesToDbRetried: 0,
    };

    // start the write Interval
    this.flushInterval = this.settings.writeInterval > 0
      ? setInterval(() => this.flush(), this.settings.writeInterval) : null;
  }

  async _lock(key) {
    while (true) {
      const l = this._locks.get(key);
      if (l == null) break;
      ++this.metrics.lockAwaits;
      await l;
    }
    ++this.metrics.lockAcquires;
    this._locks.set(key, new SelfContainedPromise());
  }

  async _unlock(key) {
    ++this.metrics.lockReleases;
    this._locks.get(key).done();
    this._locks.delete(key);
  }

  // Block flush() until _resumeFlush() is called. This is needed so that a call to flush() after a
  // write (set(), setSub(), or remove() call) in the same ECMAScript macro- or microtask will see
  // the enqueued write and flush it.
  //
  // An alternative would be to change flush() to schedule its actions in a future microtask after
  // the write has been queued in the buffer, but:
  //
  //   * That would be fragile: Every use of await moves the subsequent processing to a new
  //     microtask, so flush() would need to do a number of `await Promise.resolve();` calls equal
  //     to the number of awaits before a write is actually buffered.
  //
  //   * It won't work for setSub() because it must wait for a read to complete before it buffers
  //     the write.
  _pauseFlush() {
    if (this._flushPaused == null) {
      this._flushPaused = new SelfContainedPromise();
      this._flushPaused.count = 0;
    }
    ++this._flushPaused.count;
  }

  _resumeFlush() {
    if (--this._flushPaused.count > 0) return;
    this._flushPaused.done();
    this._flushPaused = null;
  }

  /**
   * wraps the init function of the original DB
   */
  async init() {
    await this.wrappedDB.init();
  }

  /**
   * wraps the close function of the original DB
   */
  async close() {
    clearInterval(this.flushInterval);
    await this.flush();
    await this.wrappedDB.close();
    this.wrappedDB = null;
  }

  /**
   * Gets the value trough the wrapper.
   */
  async get(key) {
    let v;
    await this._lock(key);
    try {
      v = await this._getLocked(key);
    } finally {
      this._unlock(key);
    }
    return clone(v);
  }

  async _getLocked(key) {
    ++this.metrics.reads;
    try {
      const entry = this.buffer.get(key);
      if (entry != null) {
        ++this.metrics.readsFromCache;
        if (this.logger.isDebugEnabled()) {
          this.logger.debug(`GET    - ${key} - ${JSON.stringify(entry.value)} - ` +
                            `from ${entry.dirty ? 'dirty buffer' : 'cache'}`);
        }
        return entry.value;
      }

      // get it direct
      let value;
      ++this.metrics.readsFromDb;
      try {
        value = await this.wrappedDB.get(key);
      } catch (err) {
        ++this.metrics.readsFromDbFailed;
        throw err;
      } finally {
        ++this.metrics.readsFromDbFinished;
      }
      if (this.settings.json) {
        try {
          value = JSON.parse(value);
        } catch (err) {
          this.logger.error(`JSON-PROBLEM:${value}`);
          throw err;
        }
      }

      // cache the value if caching is enabled
      if (this.settings.cache > 0) {
        this.buffer.set(key, {
          value,
          dirty: null,
          writingInProgress: false,
        });
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

  /**
   * Find keys function searches the db sets for matching entries and
   * returns the key entries via callback.
   */
  async findKeys(key, notKey) {
    await this.flush();
    const keyValues = await this.wrappedDB.findKeys(key, notKey);
    if (this.logger.isDebugEnabled()) {
      this.logger.debug(
          `GET    - ${key}-${notKey} - ${JSON.stringify(keyValues)} - from database `);
    }
    return clone(keyValues);
  }

  /**
   * Remove a record from the database
   */
  async remove(key) {
    if (this.logger.isDebugEnabled()) this.logger.debug(`DELETE - ${key} - from database `);
    await this.set(key, null);
  }

  /**
   * Sets the value trough the wrapper
   */
  async set(key, value) {
    value = clone(value);
    let p;
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

  // Implementation of the `set()` method. The record must already be locked before calling this. It
  // is safe to unlock the record before the returned Promise resolves.
  async _setLocked(key, value) {
    // IMPORTANT: This function MUST NOT use the `await` keyword before the entry in `this.buffer`
    // is added/updated. Using `await` causes execution to return to the caller, and the caller must
    // be able to immediately unlock the record to avoid unnecessary blocking while the value is
    // committed to the underlying database. If `await` is used before the entry is updated then the
    // record will be unlocked prematurely, possibly resulting in inconsistent state.
    ++this.metrics.writes;
    try {
      let entry = this.buffer.get(key);
      // If there is a write of a different value for the same key already in progress then don't
      // update the existing entry object -- create a new entry object instead and replace the old
      // one in this.buffer. (If the existing entry was updated instead, then entry.dirty would
      // resolve when the old value is committed, not the new value.)
      if (!entry || entry.writingInProgress) entry = {};
      else if (entry.dirty) ++this.metrics.writesObsoleted;
      entry.value = value;
      // Always mark as dirty even if the value did not change. This simplifies the implementation:
      // this function doesn't need to perform deep comparisons, and setSub() doesn't need to
      // perform a deep copy of the object returned from get().
      if (!entry.dirty) entry.dirty = new SelfContainedPromise();
      // buffer.set() is called even if the value is unchanged so that the cache entry is marked as
      // most recently used.
      this.buffer.set(key, entry);
      const buffered = this.settings.writeInterval > 0;
      if (this.logger.isDebugEnabled()) {
        this.logger.debug(
            `SET    - ${key} - ${JSON.stringify(value)} - to ${buffered ? 'buffer' : 'database'}`);
      }
      // Write it immediately if write buffering is disabled. If write buffering is enabled,
      // this.flush() will eventually take care of it.
      if (!buffered) this._write([[key, entry]]); // await is unnecessary.
      await entry.dirty;
    } catch (err) {
      ++this.metrics.writesFailed;
      throw err;
    } finally {
      ++this.metrics.writesFinished;
    }
  }

  /**
   * Sets a subvalue
   */
  async setSub(key, sub, value) {
    value = clone(value);
    if (this.logger.isDebugEnabled()) {
      this.logger.debug(`SETSUB - ${key}${JSON.stringify(sub)} - ${JSON.stringify(value)}`);
    }
    let p;
    this._pauseFlush();
    try {
      await this._lock(key);
      try {
        let base;
        try {
          const fullValue = await this._getLocked(key);
          base = {fullValue};
          // Emulate a pointer to the property that should be set to `value`.
          const ptr = {obj: base, prop: 'fullValue'};
          for (let i = 0; i < sub.length; i++) {
            if (sub[i] === '__proto__') {
              throw new Error('Modifying object prototype is not supported for security reasons');
            }
            let o = ptr.obj[ptr.prop];
            if (o == null) ptr.obj[ptr.prop] = o = {};
            // If o is a primitive (string, number, etc.), then setting `o.foo` has no effect
            // because ECMAScript automatically wraps primitives in a temporary wrapper object.
            if (typeof o !== 'object') {
              throw new TypeError(
                  `Cannot set property ${JSON.stringify(sub[i])} on non-object ` +
                  `${JSON.stringify(o)} (key: ${JSON.stringify(key)} ` +
                  `value in db: ${JSON.stringify(fullValue)} ` +
                  `sub: ${JSON.stringify(sub.slice(0, i + 1))})`);
            }
            ptr.obj = ptr.obj[ptr.prop];
            ptr.prop = sub[i];
          }
          ptr.obj[ptr.prop] = value;
        } catch (err) {
          // this._setLocked() will not be called but it should still count as a write failure.
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

  /**
   * Returns a sub value of the object
   * @param sub is a array, for example if you want to access object.test.bla, the array is ["test",
   *     "bla"]
   */
  async getSub(key, sub) {
    await this._lock(key);
    try {
      let v = await this._getLocked(key);
      for (const k of sub) {
        if (typeof v !== 'object' || (v != null && !Object.prototype.hasOwnProperty.call(v, k)) ||
            // __proto__ is not an "own" property but we check for it explicitly for added safety,
            // to improve readability, and to help static code analysis tools rule out prototype
            // pollution vulnerabilities.
            k === '__proto__') {
          v = null;
        }
        if (v == null) break;
        v = v[k];
      }
      if (this.logger.isDebugEnabled()) {
        this.logger.debug(`GETSUB - ${key}${JSON.stringify(sub)} - ${JSON.stringify(v)}`);
      }
      return clone(v);
    } finally {
      this._unlock(key);
    }
  }

  /**
   * Writes all dirty values to the database
   */
  async flush() {
    if (this._flushDone == null) {
      this._flushDone = (async () => {
        while (true) {
          while (this._flushPaused != null) await this._flushPaused;
          const dirtyEntries = [];
          for (const entry of this.buffer) {
            if (entry[1].dirty && !entry[1].writingInProgress) {
              dirtyEntries.push(entry);
              if (this.settings.bulkLimit && dirtyEntries.length >= this.settings.bulkLimit) break;
            }
          }
          if (dirtyEntries.length === 0) return;
          await this._write(dirtyEntries);
        }
      })();
    }
    await this._flushDone;
    this._flushDone = null;
  }

  async _write(dirtyEntries) {
    const markDone = (entry, err) => {
      if (entry.writingInProgress) {
        entry.writingInProgress = false;
        if (err != null) ++this.metrics.writesToDbFailed;
        ++this.metrics.writesToDbFinished;
      }
      // If err != null then the entry is still technically dirty, but the responsibility is on the
      // user to retry failures so from ueberDB's perspective the entry is no longer dirty.
      entry.dirty.done(err);
      entry.dirty = null;
    };
    const ops = [];
    const entries = [];
    for (const [key, entry] of dirtyEntries) {
      let value = entry.value;
      try {
        value = this.settings.json && value != null ? JSON.stringify(value) : clone(value);
      } catch (err) {
        markDone(entry, err);
        continue;
      }
      entry.writingInProgress = true;
      ops.push({type: value == null ? 'remove' : 'set', key, value});
      entries.push(entry);
    }
    if (ops.length === 0) return;
    this.metrics.writesToDb += ops.length;
    const writeOneOp = async (op, entry) => {
      let writeErr = null;
      try {
        switch (op.type) {
          case 'remove':
            await this.wrappedDB.remove(op.key);
            break;
          case 'set':
            await this.wrappedDB.set(op.key, op.value);
            break;
          default:
            throw new Error(`unsupported operation type: ${op.type}`);
        }
      } catch (err) {
        writeErr = err || new Error(err);
      }
      markDone(entry, writeErr);
    };
    if (ops.length === 1) {
      await writeOneOp(ops[0], entries[0]);
    } else {
      let success = false;
      try {
        await this.wrappedDB.doBulk(ops);
        success = true;
      } catch (err) {
        this.logger.error(
            `Bulk write of ${ops.length} ops failed, retrying individually: ${err.stack || err}`);
        this.metrics.writesToDbRetried += ops.length;
        await Promise.all(ops.map(async (op, i) => await writeOneOp(op, entries[i])));
      }
      if (success) entries.forEach((entry) => markDone(entry, null));
    }
    // At this point we could call db.buffer.evictOld() to ensure that the number of entries in
    // this.buffer is at or below capacity, but if we haven't run out of memory by this point then
    // it should be safe to continue using the memory until the next call to this.buffer.set()
    // evicts the old entries. This saves some CPU cycles at the expense of memory.
  }
};

const clone = (obj, key = '') => {
  // Handle the 3 simple types, and null or undefined
  if (null == obj || 'object' !== typeof obj) return obj;

  if (typeof obj.toJSON === 'function') return clone(obj.toJSON(key));

  // Handle Date
  if (obj instanceof Date) {
    const copy = new Date();
    copy.setTime(obj.getTime());
    return copy;
  }

  // Handle Array
  if (obj instanceof Array) {
    const copy = [];
    for (let i = 0, len = obj.length; i < len; ++i) {
      copy[i] = clone(obj[i], String(i));
    }
    return copy;
  }

  // Handle Object
  if (obj instanceof Object) {
    const copy = {};
    for (const attr in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, attr)) copy[attr] = clone(obj[attr], attr);
    }
    return copy;
  }

  throw new Error("Unable to copy obj! Its type isn't supported.");
};

exports.exportedForTesting = {
  LRU,
};
