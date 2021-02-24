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

const async = require('async');
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

/**
 The constructor of the wrapper
 @param wrappedDB The Database that should be wrapped
 @param settings (optional) The settings that should be applied to the wrapper
*/
exports.Database = function (wrappedDB, settings, logger) {
  // saved the wrappedDB
  this.wrappedDB = wrappedDB;
  this.logger = logger;

  // apply default settings
  this.settings = {};
  this.settings.cache = defaultSettings.cache;
  this.settings.writeInterval = defaultSettings.writeInterval;
  this.settings.json = defaultSettings.json;
  this.settings.charset = defaultSettings.charset;

  // try to apply the settings of the driver
  if (wrappedDB.settings != null) {
    if (wrappedDB.settings.cache != null) this.settings.cache = wrappedDB.settings.cache;
    if (wrappedDB.settings.writeInterval != null) {
      this.settings.writeInterval = wrappedDB.settings.writeInterval;
    }
    if (wrappedDB.settings.json != null) this.settings.json = wrappedDB.settings.json;
    if (wrappedDB.settings.charset != null) this.settings.charset = wrappedDB.settings.charset;
  }

  // try to apply the settings given with the constructor
  if (settings != null) {
    if (settings.cache != null) this.settings.cache = settings.cache;
    if (settings.writeInterval != null) this.settings.writeInterval = settings.writeInterval;
    if (settings.json != null) this.settings.json = settings.json;
    if (settings.charset != null) this.settings.charset = settings.charset;
  }

  // freeze the settings at this point
  this.settings = Object.freeze(this.settings);

  // The key is the database key. The value is an object with the following properties:
  //   - value: The entry's value.
  //   - dirty: If the value has not yet been written, this is a Promise that will resolve once the
  //     write to the underlying database returns. If the value has been written this is null.
  //   - writingInProgress: Boolean that if true indicates that the value has been sent to the
  //     underlying database and we are awaiting commit.
  this.buffer = new LRU(this.settings.cache, (k, v) => !v.dirty && !v.writingInProgress);

  // start the write Interval
  this.flushInterval = this.settings.writeInterval > 0
    ? setInterval(() => this.flush(), this.settings.writeInterval) : null;

  /**
   * Adds function to db wrapper for findKey regex.
   * Used by document dbs like mongodb or dirty.
   */
  wrappedDB.createFindRegex = (key, notKey) => {
    let regex = '';
    key = key.replace(/\*/g, '.*');
    regex = `(?=^${key}$)`;
    if (notKey != null) {
      notKey = notKey.replace(/\*/g, '.*');
      regex += `(?!${notKey}$)`;
    }
    return new RegExp(regex);
  };
};

/**
 wraps the init function of the original DB
*/
exports.Database.prototype.init = async function () {
  await util.promisify(this.wrappedDB.init.bind(this.wrappedDB))();
};

/**
 wraps the close function of the original DB
*/
exports.Database.prototype.close = async function () {
  clearInterval(this.flushInterval);
  await this.flush();
  await util.promisify(this.wrappedDB.close.bind(this.wrappedDB))();
  this.wrappedDB = null;
};

/**
 Gets the value trough the wrapper.
*/
exports.Database.prototype.get = async function (key) {
  const entry = this.buffer.get(key);
  if (entry != null) {
    if (this.logger.isDebugEnabled()) {
      this.logger.debug(`GET    - ${key} - ${JSON.stringify(entry.value)} - ` +
                        `from ${entry.dirty ? 'dirty buffer' : 'cache'}`);
    }
    return entry.value;
  }

  // get it direct
  let value = await util.promisify(this.wrappedDB.get.bind(this.wrappedDB))(key);
  if (this.settings.json) {
    try {
      value = JSON.parse(value);
    } catch (err) {
      console.error(`JSON-PROBLEM:${value}`);
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
};

/**
 * Find keys function searches the db sets for matching entries and
 * returns the key entries via callback.
 */
exports.Database.prototype.findKeys = function (key, notKey, callback) {
  const bufferKey = `${key}-${notKey}`;
  this.wrappedDB.findKeys(key, notKey, (err, keyValues) => {
    if (this.logger.isDebugEnabled()) {
      this.logger.debug(`GET    - ${bufferKey} - ${JSON.stringify(keyValues)} - from database `);
    }

    callback(err, keyValues);
  });
};

/**
 * Remove a record from the database
 */
exports.Database.prototype.remove = function (key, bufferCallback, writeCallback) {
  if (this.logger.isDebugEnabled()) this.logger.debug(`DELETE - ${key} - from database `);
  this.set(key, null, bufferCallback, writeCallback);
};

/**
 Sets the value trough the wrapper
*/
exports.Database.prototype.set = function (key, value, bufferCallback, writeCallback) {
  let entry = this.buffer.get(key);
  // If there is a write of a different value for the same key already in progress then don't update
  // the existing entry object -- create a new entry object instead and replace the old one in
  // this.buffer. This ensures that the writeCallback for the new value is not called until after
  // the new value is written. (If the existing entry is updated instead, then the writeCallback for
  // the new value would be called when the old value is committed, not when the new value is
  // committed.)
  if (!entry || entry.writingInProgress) entry = {};
  entry.value = value;
  // Always mark as dirty even if the value did not change. This simplifies the implementation: this
  // function doesn't need to perform deep comparisons, and setSub() doesn't need to perform a deep
  // copy of the object returned from get().
  if (!entry.dirty) entry.dirty = new SelfContainedPromise();
  // buffer.set() is called even if the value is unchanged so that the cache entry is marked as most
  // recently used.
  this.buffer.set(key, entry);
  if (bufferCallback) setImmediate(bufferCallback);
  if (writeCallback) {
    entry.dirty.then(() => writeCallback(), (err) => writeCallback(err || new Error(err)));
  }
  const buffered = this.settings.writeInterval > 0;
  if (this.logger.isDebugEnabled()) {
    this.logger.debug(
        `SET    - ${key} - ${JSON.stringify(value)} - to ${buffered ? 'buffer' : 'database'}`);
  }
  // Write it immediately if write buffering is disabled. If write buffering is enabled,
  // this.flush() will eventually take care of it.
  if (!buffered) this._write([[key, entry]]);
};

/**
 Sets a subvalue
*/
exports.Database.prototype.setSub = function (key, sub, value, bufferCallback, writeCallback) {
  if (this.logger.isDebugEnabled()) {
    this.logger.debug(`SETSUB - ${key}${JSON.stringify(sub)} - ${JSON.stringify(value)}`);
  }

  async.waterfall([
    // get the full value
    (callback) => {
      util.callbackify(this.get.bind(this))(key, callback);
    },
    // set the sub value and set the full value again
    (fullValue, callback) => {
      const base = {fullValue};
      // Emulate a pointer to the property that should be set to `value`.
      const ptr = {obj: base, prop: 'fullValue'};
      for (let i = 0; i < sub.length; i++) {
        let o = ptr.obj[ptr.prop];
        if (o == null) ptr.obj[ptr.prop] = o = {};
        // If o is a primitive (string, number, etc.), then setting `o.foo` has no effect because
        // ECMAScript automatically wraps primitives in a temporary wrapper object.
        if (typeof o !== 'object') {
          callback(new TypeError(
              `Cannot set property ${JSON.stringify(sub[i])} on non-object ${JSON.stringify(o)} ` +
              `(key: ${JSON.stringify(key)} ` +
              `value in db: ${JSON.stringify(fullValue)} ` +
              `sub: ${JSON.stringify(sub.slice(0, i + 1))})`));
          return;
        }
        ptr.obj = ptr.obj[ptr.prop];
        ptr.prop = sub[i];
      }
      ptr.obj[ptr.prop] = value;
      this.set(key, base.fullValue, bufferCallback, writeCallback);
      callback(null);
    },
  ], (err) => {
    if (err) {
      if (bufferCallback) bufferCallback(err);
      if (writeCallback) writeCallback(err);
      if (!bufferCallback && !writeCallback) throw err;
    }
  });
};

/**
 * Returns a sub value of the object
 * @param sub is a array, for example if you want to access object.test.bla, the array is ["test",
 *     "bla"]
 */
exports.Database.prototype.getSub = async function (key, sub) {
  // get the full value
  const value = await this.get(key);

  // everything is correct, navigate to the subvalue and return it
  let subvalue = value;

  for (let i = 0; i < sub.length; i++) {
    // test if the subvalue exist
    if (subvalue != null && subvalue[sub[i]] !== undefined) {
      subvalue = subvalue[sub[i]];
    } else {
      // the subvalue doesn't exist, break the loop and return null
      subvalue = null;
      break;
    }
  }

  if (this.logger.isDebugEnabled()) {
    this.logger.debug(`GETSUB - ${key}${JSON.stringify(sub)} - ${JSON.stringify(subvalue)}`);
  }
  return subvalue;
};

/**
 Writes all dirty values to the database
*/
exports.Database.prototype.flush = async function () {
  if (this._flushDone == null) {
    this._flushDone = (async () => {
      while (true) {
        const dirtyEntries = [];
        for (const entry of this.buffer) {
          if (entry[1].dirty && !entry[1].writingInProgress) dirtyEntries.push(entry);
        }
        if (dirtyEntries.length === 0) return;
        await this._write(dirtyEntries);
      }
    })();
  }
  await this._flushDone;
  this._flushDone = null;
};

exports.Database.prototype._write = async function (dirtyEntries) {
  if (dirtyEntries.length === 0) return;
  const ops = dirtyEntries.map(([key, entry]) => {
    entry.writingInProgress = true;
    const value = this.settings.json && entry.value != null
      ? JSON.stringify(entry.value) : clone(entry.value);
    return {type: entry.value == null ? 'remove' : 'set', key, value};
  });
  let writeErr = null;
  try {
    if (ops.length === 1) {
      const {type, key, value} = ops[0];
      switch (type) {
        case 'remove':
          await util.promisify(this.wrappedDB.remove.bind(this.wrappedDB))(key);
          break;
        case 'set':
          await util.promisify(this.wrappedDB.set.bind(this.wrappedDB))(key, value);
          break;
        default:
          throw new Error(`unsupported operation type: ${type}`);
      }
    } else {
      await util.promisify(this.wrappedDB.doBulk.bind(this.wrappedDB))(ops);
    }
  } catch (err) {
    writeErr = err || new Error(err);
  }
  for (const [, entry] of dirtyEntries) {
    entry.writingInProgress = false;
    entry.dirty.done(writeErr);
    // If writeErr != null then the entry is stil technically dirty, but the responsibility is on
    // the user to retry failures so from ueberDB's perspective the entry is no longer dirty.
    entry.dirty = null;
  }
  // At this point we could call db.buffer.evictOld() to ensure that the number of entries in
  // this.buffer is at or below capacity, but if we haven't run out of memory by this point then
  // it should be safe to continue using the memory until the next call to this.buffer.set()
  // evicts the old entries. This saves some CPU cycles at the expense of memory.
};

const clone = (obj) => {
  // Handle the 3 simple types, and null or undefined
  if (null == obj || 'object' !== typeof obj) return obj;

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
      copy[i] = clone(obj[i]);
    }
    return copy;
  }

  // Handle Object
  if (obj instanceof Object) {
    const copy = {};
    for (const attr in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, attr)) copy[attr] = clone(obj[attr]);
    }
    return copy;
  }

  throw new Error("Unable to copy obj! Its type isn't supported.");
};

exports.exportedForTesting = {
  LRU,
};
