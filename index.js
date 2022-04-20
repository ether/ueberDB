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
const logging = require('./lib/logging');
const util = require('util');

const cbDb = {};
const fns = ['close', 'findKeys', 'flush', 'get', 'getSub', 'init', 'remove', 'set', 'setSub'];
for (const fn of fns) cbDb[fn] = util.callbackify(cacheAndBufferLayer.Database.prototype[fn]);

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
    this.logger = logging.normalizeLogger(logger);
    const db = new this.dbModule.Database(this.dbSettings);
    db.logger = this.logger;
    this.db = new cacheAndBufferLayer.Database(db, this.wrapperSettings, this.logger);

    // Expose the cache wrapper's metrics to the user. See lib/CacheAndBufferLayer.js for details.
    //
    // WARNING: This feature is EXPERIMENTAL -- do not assume it will continue to exist in its
    // current form in a future version.
    this.metrics = this.db.metrics;
  }

  /**
   * @param callback - Deprecated. Node-style callback. If null, a Promise is returned.
   */
  init(callback = null) {
    if (callback != null) return cbDb.init.call(this.db, callback);
    return this.db.init();
  }

  /**
   * Wrapper functions
   */

  /**
   * Deprecated synonym of flush().
   *
   * @param callback - Deprecated. Node-style callback. If null, a Promise is returned.
   */
  doShutdown(callback = null) {
    return this.flush(callback);
  }

  /**
   * Writes any unsaved changes to the underlying database.
   *
   * @param callback - Deprecated. Node-style callback. If null, a Promise is returned.
   */
  flush(callback = null) {
    if (callback != null) return cbDb.flush.call(this.db, callback);
    return this.db.flush();
  }

  /**
   * @param callback - Deprecated. Node-style callback. If null, a Promise is returned.
   */
  get(key, callback = null) {
    if (callback != null) return cbDb.get.call(this.db, key, callback);
    return this.db.get(key);
  }

  /**
   * @param callback - Deprecated. Node-style callback. If null, a Promise is returned.
   */
  findKeys(key, notKey, callback = null) {
    if (callback != null) return cbDb.findKeys.call(this.db, key, notKey, callback);
    return this.db.findKeys(key, notKey);
  }

  /**
   * Removes an entry from the database if present.
   *
   * @param cb Deprecated. Node-style callback. Called when the write has been committed to the
   *     underlying database driver. If null, a Promise is returned.
   * @param deprecated Deprecated callback that is called just after cb. Ignored if cb is null.
   */
  remove(key, cb = null, deprecated = null) {
    if (cb != null) return cbDb.remove.call(this.db, key, makeDoneCallback(cb, deprecated));
    return this.db.remove(key);
  }

  /**
   * Adds or changes the value of an entry.
   *
   * @param cb Deprecated. Node-style callback. Called when the write has been committed to the
   *     underlying database driver. If null, a Promise is returned.
   * @param deprecated Deprecated callback that is called just after cb. Ignored if cb is null.
   */
  set(key, value, cb = null, deprecated = null) {
    if (cb != null) return cbDb.set.call(this.db, key, value, makeDoneCallback(cb, deprecated));
    return this.db.set(key, value);
  }

  /**
   * @param callback - Deprecated. Node-style callback. If null, a Promise is returned.
   */
  getSub(key, sub, callback = null) {
    if (callback != null) return cbDb.getSub.call(this.db, key, sub, callback);
    return this.db.getSub(key, sub);
  }

  /**
   * Adds or changes a subvalue of an entry.
   *
   * @param cb Deprecated. Node-style callback. Called when the write has been committed to the
   *     underlying database driver. If null, a Promise is returned.
   * @param deprecated Deprecated callback that is called just after cb. Ignored if cb is null.
   */
  setSub(key, sub, value, cb = null, deprecated = null) {
    if (cb != null) {
      return cbDb.setSub.call(this.db, key, sub, value, makeDoneCallback(cb, deprecated));
    }
    return this.db.setSub(key, sub, value);
  }

  /**
   * Flushes unwritten changes then closes the connection to the underlying database. After this
   * returns, any future call to a method on this object may result in an error.
   *
   * @param callback - Deprecated. Node-style callback. If null, a Promise is returned.
   */
  close(callback = null) {
    if (callback != null) return cbDb.close.call(this.db, callback);
    return this.db.close();
  }
};

/**
 * Deprecated synonym of Database.
 */
exports.database = exports.Database;
