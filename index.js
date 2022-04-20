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

  init(callback) {
    if (callback) {
      cbDb.init.call(this.db, callback);
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
    cbDb.flush.call(this.db, callback);
  }

  get(key, callback) {
    cbDb.get.call(this.db, key, callback);
  }

  findKeys(key, notKey, callback) {
    cbDb.findKeys.call(this.db, key, notKey, callback);
  }

  /**
   * Removes an entry from the database if present.
   *
   * @param cb Called when the write has been committed to the underlying database driver.
   * @param deprecated Deprecated callback that is called just after cb.
   */
  remove(key, cb, deprecated = null) {
    cbDb.remove.call(this.db, key, makeDoneCallback(cb, deprecated));
  }

  /**
   * Adds or changes the value of an entry.
   *
   * @param cb Called when the write has been committed to the underlying database driver.
   * @param deprecated Deprecated callback that is called just after cb.
   */
  set(key, value, cb, deprecated = null) {
    cbDb.set.call(this.db, key, value, makeDoneCallback(cb, deprecated));
  }

  getSub(key, sub, callback) {
    cbDb.getSub.call(this.db, key, sub, callback);
  }

  /**
   * Adds or changes a subvalue of an entry.
   *
   * @param cb Called when the write has been committed to the underlying database driver.
   * @param deprecated Deprecated callback that is called just after cb.
   */
  setSub(key, sub, value, cb, deprecated = null) {
    cbDb.setSub.call(this.db, key, sub, value, makeDoneCallback(cb, deprecated));
  }

  /**
   * Flushes unwritten changes then closes the connection to the underlying database. After this
   * returns, any future call to a method on this object may result in an error.
   */
  close(callback) {
    cbDb.close.call(this.db, callback);
  }
};

/**
 * Deprecated synonym of Database.
 */
exports.database = exports.Database;
