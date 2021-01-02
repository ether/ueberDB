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
exports.database = function (wrappedDB, settings, logger) {
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
    ? setInterval(() => flush(this), this.settings.writeInterval) : null;

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
exports.database.prototype.init = function (callback) {
  this.wrappedDB.init(callback);
};

/**
 wraps the close function of the original DB
*/
exports.database.prototype.close = function (callback) {
  this.wrappedDB.close(callback);
};

/**
 Calls the callback the next time all buffers are flushed
*/
exports.database.prototype.doShutdown = function (callback) {
  // wait until the buffer is fully written
  if (this.settings.writeInterval > 0) this.shutdownCallback = callback;
  // we write direct, so there is no need to wait for a callback
  else callback();
};

/**
 Gets the value trough the wrapper.
*/
exports.database.prototype.get = function (key, callback) {
  const entry = this.buffer[key];
  // if cache is enabled and data is in the cache, get the value from the cache
  if (this.settings.cache > 0 && entry) {
    this.logger.debug(`GET    - ${key} - ${JSON.stringify(entry.value)} - from cache`);
    entry.timestamp = new Date().getTime();
    callback(null, entry.value);
  } else if (this.settings.cache === 0 && entry && entry.dirty) {
    // caching is disabled but its still in a dirty writing cache, so we have to get the value out
    // of the cache too
    this.logger.debug(`GET    - ${key} - ${JSON.stringify(entry.value)} - from dirty buffer`);
    entry.timestamp = new Date().getTime();
    callback(null, entry.value);
  } else {
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

      this.logger.debug(`GET    - ${key} - ${JSON.stringify(value)} - from database `);

      callback(err, value);
    });
  }
};

/**
 * Find keys function searches the db sets for matching entries and
 * returns the key entries via callback.
 */
exports.database.prototype.findKeys = function (key, notKey, callback) {
  const bufferKey = `${key}-${notKey}`;
  this.wrappedDB.findKeys(key, notKey, (err, keyValues) => {
    // call the garbage collector
    this.gc();

    this.logger.debug(`GET    - ${bufferKey} - ${JSON.stringify(keyValues)} - from database `);

    callback(err, keyValues);
  });
};

/**
 * Remove a record from the database
 */
exports.database.prototype.remove = function (key, bufferCallback, writeCallback) {
  this.logger.debug(`DELETE - ${key} - from database `);

  this.set(key, null, bufferCallback, writeCallback);
};

/**
 Sets the value trough the wrapper
*/
exports.database.prototype.set = function (key, value, bufferCallback, writeCallback) {
  // writing cache is enabled, so simply write it into the buffer
  if (this.settings.writeInterval > 0) {
    this.logger.debug(`SET    - ${key} - ${JSON.stringify(value)} - to buffer`);

    let entry = this.buffer[key];
    // initalize the buffer object if it not exists
    if (!entry) {
      entry = this.buffer[key] = {};
      this.bufferLength++;
    }

    // set the new values
    entry.value = value;
    entry.dirty = true;
    entry.timestamp = new Date().getTime();

    // call the garbage collector
    this.gc();

    // initalize the callback array in the buffer object if it not exists. we need this as an array,
    // cause the value may be many times overwritten bevors its finally written to the database, but
    // all callbacks must be called
    if (!entry.callbacks) entry.callbacks = [];

    // add this callback to the array
    if (!writeCallback) writeCallback = (err) => { if (err != null) throw err; };
    entry.callbacks.push(writeCallback);

    // call the buffer callback
    if (bufferCallback) bufferCallback();
  } else {
    // writecache is disabled, so we write directly to the database
    this.logger.debug(`SET    - ${key} - ${JSON.stringify(value)} - to database`);

    // create a wrapper callback for write and buffer callback
    const callback = (err) => {
      if (bufferCallback) bufferCallback(err);
      if (writeCallback) writeCallback(err);
    };

    // The value is null, means this no set operation, this is a remove operation
    if (value == null) {
      this.wrappedDB.remove(key, callback);
    } else {
      // thats a correct value
      // stringify the value if stringifying is enabled
      if (this.settings.json === true) value = JSON.stringify(value);

      this.wrappedDB.set(key, value, callback);
    }
  }
};

/**
 Sets a subvalue
*/
exports.database.prototype.setSub = function (key, sub, value, bufferCallback, writeCallback) {
  this.logger.debug(`SETSUB - ${key}${JSON.stringify(sub)} - ${JSON.stringify(value)}`);

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
exports.database.prototype.getSub = function (key, sub, callback) {
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

      this.logger.debug(`GETSUB - ${key}${JSON.stringify(sub)} - ${JSON.stringify(subvalue)}`);
      callback(err, subvalue);
    }
  });
};

/**
 Garbage Collector of the cache
*/
exports.database.prototype.gc = function () {
  // If the buffer size is under the settings size or cache is disabled -> return cause there is
  // nothing to do
  if (this.bufferLength < this.settings.cache || this.settings.cache === 0) {
    return;
  }

  // collect all values that are not dirty
  const deleteCandidates = [];
  // This could instead use `for..of` with `Object.entries`, but `for..in` with
  // `Object.prototype.hasOwnProperty` avoids the overhead of creating an array with all of the
  // entries. The buffer object could have hundreds of entries, so the overhead could be noticeable.
  // (No profiling has been performed however.)
  for (const key in this.buffer) {
    if (!Object.prototype.hasOwnProperty.call(this.buffer, key)) continue;
    const entry = this.buffer[key];
    if (entry.dirty === false && entry.writingInProgress === false) {
      deleteCandidates.push({key, timestamp: entry.timestamp});
    }
  }
  deleteCandidates.sort((a, b) => a.timestamp - b.timestamp);
  for (const {key} of deleteCandidates) {
    if (this.bufferLength <= this.settings.cache / 2) break;
    delete this.buffer[key];
    this.bufferLength--;
  }
};

/**
 Writes all dirty values to the database
*/
const flush = (db, callback) => {
  // return if there is a flushing action in process
  if (db.isFlushing) {
    if (callback) callback();
    return;
  }

  const operations = [];
  let callbacks = [];

  // This could instead use `for..of` with `Object.entries`, but `for..in` with
  // `Object.prototype.hasOwnProperty` avoids the overhead of creating an array with all of the
  // entries. The buffer object could have hundreds of entries, so the overhead could be noticeable.
  // (No profiling has been performed however.)
  for (const key in db.buffer) {
    if (!Object.prototype.hasOwnProperty.call(db.buffer, key)) continue;
    const entry = db.buffer[key];
    if (entry.dirty !== true) continue;

    // collect all data for the operation
    let value = entry.value;
    const type = value == null ? 'remove' : 'set';

    // stringify the value if stringifying is enabled
    if (db.settings.json === true && value != null) value = JSON.stringify(value);
    else value = clone(value);

    // add the operation to the operations array
    operations.push({type, key, value});

    // collect callbacks
    callbacks = callbacks.concat(entry.callbacks);

    // clean callbacks
    entry.callbacks = [];
    // set the dirty flag to false
    entry.dirty = false;
    // set the writingInProgress flag to true
    entry.writingInProgress = true;
  }

  // send the bulk to the database driver and call the callbacks with the results
  if (operations.length > 0) {
    // set the flushing flag
    db.isFlushing = true;

    db.wrappedDB.doBulk(operations, (err) => {
      // call all writingCallbacks
      for (const cb of callbacks) {
        cb(err);
      }

      // set the writingInProgress flag to false
      for (const {key} of operations) {
        db.buffer[key].writingInProgress = false;
      }

      if (callback) callback();

      // call the garbage collector
      db.gc();

      // set the flushing flag to false
      db.isFlushing = false;
    });
  } else if (db.shutdownCallback != null) {
    // the writing buffer is empty and there is a shutdown callback, call it!
    clearInterval(db.flushInterval);
    db.shutdownCallback();
    db.shutdownCallback = null;
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
