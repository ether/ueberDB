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
 * wraps the init function of the original DB
 * @param callback Node-style callback. If null, a Promise is returned instead.
 */
exports.Database.prototype.init = function (callback = null) {
  const init = this.wrappedDB.init.bind(this.wrappedDB);
  if (callback == null) return util.promisify(init)();
  init(callback);
};

/**
 * wraps the close function of the original DB
 * @param callback Node-style callback. If null, a Promise is returned instead.
 */
exports.Database.prototype.close = function (callback = null) {
  const close = this.wrappedDB.close.bind(this.wrappedDB);
  if (callback == null) return util.promisify(close)();
  close(callback);
};

/**
 * Calls the callback the next time all buffers are flushed
 * @param callback Node-style callback. If null, a Promise is returned instead.
 */
exports.Database.prototype.doShutdown = function (callback = null) {
  let p;
  if (callback == null) {
    p = new Promise((resolve, reject) => {
      callback = (err) => { if (err != null) return reject(err); resolve(); };
    });
  }
  // wait until the buffer is fully written
  if (this.settings.writeInterval > 0) this.shutdownCallback = callback;
  // we write direct, so there is no need to wait for a callback
  else callback();
  return p;
};

/**
 * Gets the value trough the wrapper.
 * @param callback Node-style callback. If null, a Promise is returned instead.
 */
exports.Database.prototype.get = function (key, callback = null) {
  if (callback == null) return this._get(key);
  util.callbackify(this._get.bind(this))(key, callback);
};

exports.Database.prototype._get = async function (key) {
  const entry = this.buffer[key];
  // if cache is enabled and data is in the cache, get the value from the cache
  if (this.settings.cache > 0 && entry) {
    this.logger.debug(`GET    - ${key} - ${JSON.stringify(entry.value)} - from cache`);
    entry.timestamp = new Date().getTime();
    return entry.value;
  }
  if (this.settings.cache === 0 && entry && entry.dirty) {
    // caching is disabled but its still in a dirty writing cache, so we have to get the value out
    // of the cache too
    this.logger.debug(`GET    - ${key} - ${JSON.stringify(entry.value)} - from dirty buffer`);
    entry.timestamp = new Date().getTime();
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

  return value;
};

/**
 * Find keys function searches the db sets for matching entries and
 * returns the key entries via callback.
 * @param callback Node-style callback. If null, a Promise is returned instead.
 */
exports.Database.prototype.findKeys = function (key, notKey, callback = null) {
  if (callback == null) return this._findKeys(key, notKey);
  util.callbackify(this._findKeys.bind(this))(key, notKey, callback);
};

exports.Database.prototype._findKeys = async function (key, notKey) {
  const bufferKey = `${key}-${notKey}`;
  const keyValues = await util.promisify(this.wrappedDB.findKeys.bind(this.wrappedDB))(key, notKey);

  // call the garbage collector
  this.gc();

  this.logger.debug(`GET    - ${bufferKey} - ${JSON.stringify(keyValues)} - from database `);

  return keyValues;
};

/**
 * Remove a record from the database
 * @param bufferedCb Node-style callback that is called when the change has been buffered but not
 *     yet written to disk.
 * @param writtenCb Node-style callback that is called when the change has been written to disk. If
 *     null, a Promise is returned instead.
 */
exports.Database.prototype.remove = function (key, bufferedCb = () => {}, writtenCb = null) {
  this.logger.debug(`DELETE - ${key} - from database `);

  return this.set(key, null, bufferedCb, writtenCb);
};

/**
 * Sets the value trough the wrapper
 * @param bufferedCb Node-style callback that is called when the change has been buffered but not
 *     yet written to disk.
 * @param writtenCb Node-style callback that is called when the change has been written to disk. If
 *     null, a Promise is returned instead.
 */
exports.Database.prototype.set = function (k, v, bufferedCb = () => {}, writtenCb = null) {
  if (writtenCb == null) return this._set(k, v, bufferedCb);
  util.callbackify(this._set.bind(this))(k, v, bufferedCb, writtenCb);
};

exports.Database.prototype._set = async function (key, value, bufferCallback = () => {}) {
  const buffered = this.settings.writeInterval > 0;
  let entry;
  if (buffered) {
    // writing cache is enabled, so simply write it into the buffer
    this.logger.debug(`SET    - ${key} - ${JSON.stringify(value)} - to buffer`);

    entry = this.buffer[key];
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
  } else {
    // writecache is disabled, so we write directly to the database
    this.logger.debug(`SET    - ${key} - ${JSON.stringify(value)} - to database`);

    if (value == null) {
      // The value is null, means this no set operation, this is a remove operation
      await util.promisify(this.wrappedDB.remove.bind(this.wrappedDB))(key);
    } else {
      // thats a correct value
      // stringify the value if stringifying is enabled
      if (this.settings.json === true) value = JSON.stringify(value);
      await util.promisify(this.wrappedDB.set.bind(this.wrappedDB))(key, value);
    }
  }
  bufferCallback();
  if (buffered) {
    // initalize the callback array in the buffer object if it not exists. we need this as an array,
    // cause the value may be many times overwritten bevors its finally written to the database, but
    // all callbacks must be called
    if (!entry.callbacks) entry.callbacks = [];
    await new Promise((resolve, reject) => {
      entry.callbacks.push((err) => {
        if (err != null) return reject(err);
        resolve();
      });
    });
  }
};

/**
 * Sets a subvalue
 * @param bufferedCb Node-style callback that is called when the change has been buffered but not
 *     yet written to disk.
 * @param writtenCb Node-style callback that is called when the change has been written to disk. If
 *     null, a Promise is returned instead.
 */
exports.Database.prototype.setSub = function (k, sub, v, bufferedCb = () => {}, writtenCb = null) {
  if (writtenCb == null) return this._setSub(k, sub, v, bufferedCb);
  util.callbackify(this._setSub.bind(this))(k, sub, v, bufferedCb, writtenCb);
};

exports.Database.prototype._setSub = async function (key, sub, value, bufferCallback = () => {}) {
  this.logger.debug(`SETSUB - ${key}${JSON.stringify(sub)} - ${JSON.stringify(value)}`);
  let fullValue;
  try {
    fullValue = await this._get(key);
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
  } catch (err) {
    bufferCallback(err);
    throw err;
  }
  return await this._set(key, fullValue, bufferCallback);
};

/**
 * Returns a sub value of the object
 * @param sub is a array, for example if you want to access object.test.bla, the array is ["test",
 *     "bla"]
 * @param callback Node-style callback. If null, a Promise is returned instead.
 */
exports.Database.prototype.getSub = function (key, sub, callback = null) {
  if (callback == null) return this._getSub(key, sub);
  util.callbackify(this._getSub.bind(this))(key, sub, callback);
};

exports.Database.prototype._getSub = async function (key, sub) {
  const value = await this._get(key);
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
  return subvalue;
};

/**
 Garbage Collector of the cache
*/
exports.Database.prototype.gc = function () {
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
const flush = async (db) => {
  if (db.isFlushing) return;

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

    let err = null;
    try {
      await util.promisify(db.wrappedDB.doBulk.bind(db.wrappedDB))(operations);
    } catch (error) {
      err = error || new Error(error);
    }
    // call all writingCallbacks
    for (const cb of callbacks) {
      cb(err);
    }

    // set the writingInProgress flag to false
    for (const {key} of operations) {
      db.buffer[key].writingInProgress = false;
    }

    // call the garbage collector
    db.gc();

    // set the flushing flag to false
    db.isFlushing = false;
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
