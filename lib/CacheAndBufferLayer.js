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

  this.buffer = {};
  this.bufferLength = 0;

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

  // start the write Interval
  this.flushInterval = this.settings.writeInterval > 0
    ? setInterval(() => this.flush(), this.settings.writeInterval) : null;

  // set the flushing flag to false, this flag shows that there is a flushing action happing at the
  // moment
  this.isFlushing = false;

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
exports.Database.prototype.init = function (callback) {
  this.wrappedDB.init(callback);
};

/**
 wraps the close function of the original DB
*/
exports.Database.prototype.close = function (callback) {
  this.wrappedDB.close(callback);
};

/**
 Calls the callback the next time all buffers are flushed
*/
exports.Database.prototype.doShutdown = function (callback) {
  // wait until the buffer is fully written
  if (this.settings.writeInterval > 0) this.shutdownCallback = callback;
  // we write direct, so there is no need to wait for a callback
  else callback();
};

/**
 Gets the value trough the wrapper.
*/
exports.Database.prototype.get = function (key, callback) {
  const entry = this.buffer[key];
  if (entry != null) {
    if (this.logger.isDebugEnabled()) {
      this.logger.debug(`GET    - ${key} - ${JSON.stringify(entry.value)} - ` +
                        `from ${entry.dirty ? 'dirty buffer' : 'cache'}`);
    }
    entry.timestamp = new Date().getTime();
    return callback(null, entry.value);
  }
  // get it direct
  this.wrappedDB.get(key, (err, value) => {
    if (this.settings.json) {
      try {
        value = JSON.parse(value);
      } catch (e) {
        console.error(`JSON-PROBLEM:${value}`);
        callback(e);
        return;
      }
    }

    // cache the value if caching is enabled
    if (this.settings.cache > 0) {
      this.buffer[key] = {
        value,
        dirty: false,
        timestamp: new Date().getTime(),
        writingInProgress: false,
      };
    }
    this.bufferLength++;

    // call the garbage collector
    this.gc();

    if (this.logger.isDebugEnabled()) {
      this.logger.debug(`GET    - ${key} - ${JSON.stringify(value)} - from database `);
    }

    callback(err, value);
  });
};

/**
 * Find keys function searches the db sets for matching entries and
 * returns the key entries via callback.
 */
exports.Database.prototype.findKeys = function (key, notKey, callback) {
  const bufferKey = `${key}-${notKey}`;
  this.wrappedDB.findKeys(key, notKey, (err, keyValues) => {
    // call the garbage collector
    this.gc();

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
  let entry = this.buffer[key];
  // If there is a write of a different value for the same key already in progress then don't update
  // the existing entry object -- create a new entry object instead and replace the old one in
  // this.buffer. This ensures that the writeCallback for the new value is not called until after
  // the new value is written. (If the existing entry is updated instead, then the writeCallback for
  // the new value would be called when the old value is committed, not when the new value is
  // committed.)
  if (!entry || (entry.writingInProgress && entry.value !== value)) {
    // Only update this.bufferLength when a new entry is going to be added to this.buffer, not when
    // an existing entry is going to be replaced. This ensures an accurate count of the number of
    // entries in this.buffer, but it undercounts the number of entries that exist in memory:
    // Whenever there is an write in progress and the value is updated by a call to set(), there
    // will be two entries in memory for the same key: the in-progress entry (this._write() holds a
    // reference to that entry) and a dirty entry in this.buffer.
    if (!entry) this.bufferLength++;
    entry = this.buffer[key] = {value, dirty: true};
  } else if (entry.value !== value) {
    entry.value = value;
    entry.dirty = true;
  }
  entry.timestamp = new Date().getTime();
  if (bufferCallback) setImmediate(bufferCallback);
  if (!entry.dirty) {
    if (writeCallback) setImmediate(writeCallback);
    return;
  }
  this.gc();
  if (!entry.callbacks) entry.callbacks = [];
  entry.callbacks.push(writeCallback || ((err) => { if (err != null) throw err; }));
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
      this.get(key, callback);
    },
    // set the sub value and set the full value again
    (fullValue, callback) => {
      // get the subvalue parent
      let subvalueParent = fullValue;
      for (let i = 0; i < (sub.length - 1); i++) {
        // test if the subvalue exist
        if (subvalueParent != null && subvalueParent[sub[i]] !== undefined) {
          subvalueParent = subvalueParent[sub[i]];
        } else {
          // the subvalue doesn't exist, create it
          subvalueParent[sub[i]] = {};
          subvalueParent = subvalueParent[sub[i]];
        }
      }

      // set the subvalue, we're doing that with the parent element
      subvalueParent[sub[sub.length - 1]] = value;
      this.set(key, fullValue, bufferCallback, writeCallback);
      callback(null);
    },
  ], (err) => {
    if (err) {
      if (bufferCallback) bufferCallback(err);
      else if (writeCallback) writeCallback(err);
      else throw err;
    }
  });
};

/**
 * Returns a sub value of the object
 * @param sub is a array, for example if you want to access object.test.bla, the array is ["test",
 *     "bla"]
 */
exports.Database.prototype.getSub = function (key, sub, callback) {
  // get the full value
  this.get(key, (err, value) => {
    // there happens an errror while getting this value, call callback
    if (err) {
      callback(err);
    } else {
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
      callback(err, subvalue);
    }
  });
};

/**
 Garbage Collector of the cache
*/
exports.Database.prototype.gc = function () {
  if (this.bufferLength <= this.settings.cache) return;

  // collect all values that are not dirty
  const deleteCandidates = [];
  // This could instead use `for..of` with `Object.entries`, but `for..in` with
  // `Object.prototype.hasOwnProperty` avoids the overhead of creating an array with all of the
  // entries. The buffer object could have hundreds of entries, so the overhead could be noticeable.
  // (No profiling has been performed however.)
  for (const key in this.buffer) {
    if (!Object.prototype.hasOwnProperty.call(this.buffer, key)) continue;
    const entry = this.buffer[key];
    if (!entry.dirty && !entry.writingInProgress) {
      deleteCandidates.push({key, timestamp: entry.timestamp});
    }
  }
  deleteCandidates.sort((a, b) => a.timestamp - b.timestamp);
  for (const {key} of deleteCandidates) {
    if (this.bufferLength <= this.settings.cache) break;
    delete this.buffer[key];
    this.bufferLength--;
  }
};

/**
 Writes all dirty values to the database
*/
exports.Database.prototype.flush = function (callback) {
  // return if there is a flushing action in process
  if (this.isFlushing) {
    if (callback) callback();
    return;
  }
  const dirtyEntries = [];
  // This could instead use `for..of` with `Object.entries`, but `for..in` with
  // `Object.prototype.hasOwnProperty` avoids the overhead of creating an array with all of the
  // entries. The buffer object could have hundreds of entries, so the overhead could be noticeable.
  // (No profiling has been performed however.)
  for (const key in this.buffer) {
    if (!Object.prototype.hasOwnProperty.call(this.buffer, key)) continue;
    const entry = this.buffer[key];
    if (!entry.dirty) continue;
    dirtyEntries.push([key, entry]);
  }
  if (dirtyEntries.length > 0) {
    this.isFlushing = true;
    this._write(dirtyEntries, (err) => {
      this.isFlushing = false;
      if (callback) callback(err);
    });
    return;
  }
  if (callback) setImmediate(callback);
  if (this.shutdownCallback != null) {
    // the writing buffer is empty and there is a shutdown callback, call it!
    clearInterval(this.flushInterval);
    this.shutdownCallback();
    this.shutdownCallback = null;
  }
};

exports.Database.prototype._write = function (dirtyEntries, callback = null) {
  if (dirtyEntries.length === 0) {
    if (callback) setImmediate(callback);
    return;
  }
  const writtenCallback = (err) => {
    for (const [, entry] of dirtyEntries) {
      entry.writingInProgress = false;
      // setImmediate() is used to address a corner case: If setImmediate() was not used and one of
      // these callbacks called set() for the same key but a different value, the new callback
      // passed to set() would be immediately added to this entry.callbacks list and thus called
      // prematurely.
      //
      // An alternative approach to address the same corner case: Set writingInProgress to false
      // *after* calling the callbacks, not before. This would cause set() to generate a new dirty
      // entry (and thus an independent callback list) for the key. There are a few disadvantages to
      // this alternative approach:
      //   * writingInProgress will be true while the callbacks are running even though the write
      //     has completed. That could be confusing when debugging.
      //   * If set() is called for the same key as this entry but with a different value, two
      //     entries for the same key will briefly exist at the same time: One referenced here (in
      //     the dirtyEntries list) and one saved in this.buffer.
      //   * If set() is called for the same key as this entry and with the same value, the
      //     callbacks list for this entry will be mutated during iteration. In general, it is
      //     dangerous to mutate a container during iteration (doing so is a code smell).
      for (const cb of entry.callbacks) setImmediate(() => cb(err));
      entry.callbacks.length = 0;
    }
    if (callback) callback();
    this.gc();
  };
  const ops = dirtyEntries.map(([key, entry]) => {
    entry.dirty = false;
    entry.writingInProgress = true;
    const value = this.settings.json && entry.value != null
      ? JSON.stringify(entry.value) : clone(entry.value);
    return {type: entry.value == null ? 'remove' : 'set', key, value};
  });
  if (ops.length === 1) {
    const {type, key, value} = ops[0];
    switch (type) {
      case 'remove':
        this.wrappedDB.remove(key, writtenCallback);
        break;
      case 'set':
        this.wrappedDB.set(key, value, writtenCallback);
        break;
      default:
        throw new Error(`unsupported operation type: ${type}`);
    }
  } else {
    this.wrappedDB.doBulk(ops, writtenCallback);
  }
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
