'use strict';

/**
 * 2011 Peter 'Pita' Martischka
 * 2020 John McLear
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

const cacheAndBufferLayer = require('./lib/CacheAndBufferLayer');
const util = require('util');

// Returns a logger derived from the given logger (which may be null) that has debug() and
// isDebugEnabled() methods.
const normalizeLogger = (logger) => {
  const logLevelsUsed = ['debug', 'error'];
  logger = Object.create(logger || {});
  for (const level of logLevelsUsed) {
    const enabledFnName = `is${level.charAt(0).toUpperCase() + level.slice(1)}Enabled`;
    if (typeof logger[level] !== 'function') {
      logger[level] = () => {};
      logger[enabledFnName] = () => false;
    } else if (typeof logger[enabledFnName] !== 'function') {
      logger[enabledFnName] = () => true;
    }
  }
  return logger;
};

const makeDoneCallback = (callback, deprecated) => (err) => {
  if (callback) callback(err);
  if (deprecated) deprecated(err);
  if (err != null && callback == null && deprecated == null) throw err;
};

exports.Database = class {
  /**
   * @param logger Optional logger object. If no logger object is provided no logging will occur.
   *     The logger object is expected to be a log4js logger object or `console`. A logger object
   *     from another logging library should also work, but performance may be reduced if the logger
   *     object does not have is${Level}Enabled() methods (isDebugEnabled(), etc.).
   */
  constructor(type, dbSettings, wrapperSettings, logger = null) {
    if (!type) {
      type = 'sqlite';
      dbSettings = null;
      wrapperSettings = null;
    }

    // saves all settings and require the db module
    this.type = type;
    this.dbModule = require(`./databases/${type}_db`);
    this.dbSettings = dbSettings;
    this.wrapperSettings = wrapperSettings;
    this.logger = normalizeLogger(logger);
    const db = new this.dbModule.Database(this.dbSettings);
    this.db = new cacheAndBufferLayer.Database(db, this.wrapperSettings, this.logger);

    // Expose the cache wrapper's metrics to the user. See lib/CacheAndBufferLayer.js for details.
    //
    // WARNING: This feature is EXPERIMENTAL -- do not assume it will continue to exist in its
    // current form in a future version.
    this.metrics = this.db.metrics;
  }

  init(callback) {
    if (callback) {
      util.callbackify(this.db.init.bind(this.db))(callback);
    } else {
      return this.db.init();
    }
  }

  /**
   * Wrapper functions
   */

  /**
   * Deprecated synonym of flush().
   */
  doShutdown(callback) {
    this.flush(callback);
  }

  /**
   * Writes any unsaved changes to the underlying database.
   */
  flush(callback) {
    util.callbackify(this.db.flush.bind(this.db))(callback);
  }

  get(key, callback) {
    util.callbackify(this.db.get.bind(this.db))(key, (err, val) => callback(err, clone(val)));
  }

  findKeys(key, notKey, callback) {
    util.callbackify(this.db.findKeys.bind(this.db))(key, notKey, (e, v) => callback(e, clone(v)));
  }

  /**
   * Removes an entry from the database if present.
   *
   * @param cb Called when the write has been committed to the underlying database driver.
   * @param deprecated Deprecated callback that is called just after cb.
   */
  remove(key, cb, deprecated = null) {
    util.callbackify(this.db.remove.bind(this.db))(key, makeDoneCallback(cb, deprecated));
  }

  /**
   * Adds or changes the value of an entry.
   *
   * @param cb Called when the write has been committed to the underlying database driver.
   * @param deprecated Deprecated callback that is called just after cb.
   */
  set(key, value, cb, deprecated = null) {
    util.callbackify(this.db.set.bind(this.db))(
        key, clone(value), makeDoneCallback(cb, deprecated));
  }

  getSub(key, sub, callback) {
    util.callbackify(this.db.getSub.bind(this.db))(
        key, sub, (err, val) => callback(err, clone(val)));
  }

  /**
   * Adds or changes a subvalue of an entry.
   *
   * @param cb Called when the write has been committed to the underlying database driver.
   * @param deprecated Deprecated callback that is called just after cb.
   */
  setSub(key, sub, value, cb, deprecated = null) {
    util.callbackify(this.db.setSub.bind(this.db))(
        key, sub, clone(value), makeDoneCallback(cb, deprecated));
  }

  /**
   * Flushes unwritten changes then closes the connection to the underlying database. After this
   * returns, any future call to a method on this object may result in an error.
   */
  close(callback) {
    util.callbackify(this.db.close.bind(this.db))(callback);
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

/**
 * Deprecated synonym of Database.
 */
exports.database = exports.Database;
