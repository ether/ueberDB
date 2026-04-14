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

import {Database as DatabaseCache} from './lib/CacheAndBufferLayer';
import {normalizeLogger} from './lib/logging';
import {callbackify} from 'util';
import {Settings} from './lib/AbstractDatabase';
// Database drivers are loaded lazily in initDB() so that only the selected
// backend's dependencies need to be installed. This avoids crashes when
// optional drivers (cassandra, mongodb, mssql, etc.) are not present.

type CBDBType = {
  [key: string]:Function
}


export type DatabaseType =
    | 'mysql'
    | 'postgres'
    | 'sqlite'
    | 'rustydb'
    | 'mongodb'
    | 'redis'
    | 'cassandra'
    | 'dirty'
    | 'dirtygit'
    | 'elasticsearch'
    | 'memory'
    | 'mock'
    | 'mssql'
    | 'postgrespool'
    | 'rethink'
    | 'couch'
    | 'surrealdb';

const cbDb: CBDBType= {
  init: () => {},
  flush: () => {},
  set: () => {},
  get: () => {},
  remove: () => {},
  findKeys: () => {},
  close: () => {},
  getSub: () => {},
  setSub: () => {},
};
const fns = ['close', 'findKeys', 'flush', 'get', 'getSub', 'init', 'remove', 'set', 'setSub'];
for (const fn of fns) {
  if (fn in cbDb){
    // @ts-ignore
    cbDb[fn] =  callbackify(DatabaseCache.prototype[fn]);
  }
}
const makeDoneCallback = (callback: (err?:any)=>{}, deprecated:(err:any)=>{}) => (err: null) => {
  if (callback) callback(err);
  if (deprecated) deprecated(err);
  if (err != null && callback == null && deprecated == null) throw err;
};

export class Database {
  public readonly type: DatabaseType;
  public readonly dbSettings: any;
  public readonly wrapperSettings: any | {};
  public readonly logger: Function | null;
  public db: any;
  public metrics: any;
  /**
   * @param type The type of the database
   * @param dbSettings The settings for that specific database type
   * @param wrapperSettings
   * @param logger Optional logger object. If no logger object is provided no logging will occur.
   *     The logger object is expected to be a log4js logger object or `console`. A logger object
   *     from another logging library should also work, but performance may be reduced if the logger
   *     object does not have is${Level}Enabled() methods (isDebugEnabled(), etc.).
   */
  constructor(type: undefined | DatabaseType, dbSettings: Settings | null | string, wrapperSettings?: null | {}, logger: any = null) {
    if (!type) {
      type = 'sqlite';
      dbSettings = null;
      wrapperSettings = null;
    }

    // saves all settings and require the db module
    this.type = type;
    this.dbSettings = dbSettings;
    this.wrapperSettings = wrapperSettings;
    this.logger = normalizeLogger(logger);

  }

  /**
   * @param callback - Deprecated. Node-style callback. If null, a Promise is returned.
   */
  init(callback = null) {
    const p = this.initDB().then((db: any) => {
      db.logger = this.logger;
      this.db = new DatabaseCache(db, this.wrapperSettings, this.logger);
      this.metrics = this.db.metrics;
      return this.db.init();
    });
    if (callback != null) {
      return cbDb.init.call({init: () => p});
    }
    return p;
  }

  async initDB(){
    switch (this.type){
        case 'mysql':
            return new (await import('./databases/mysql_db')).default(this.dbSettings);
        case 'postgres':
            return new (await import('./databases/postgres_db')).default(this.dbSettings);
        case 'sqlite':
            return new (await import('./databases/sqlite_db')).default(this.dbSettings);
        case 'rustydb':
            return new (await import('./databases/rusty_db')).default(this.dbSettings);
        case 'mongodb':
            return new (await import('./databases/mongodb_db')).default(this.dbSettings);
        case 'redis':
            return new (await import('./databases/redis_db')).default(this.dbSettings);
        case 'cassandra':
            return new (await import('./databases/cassandra_db')).default(this.dbSettings);
        case 'dirty':
            return new (await import('./databases/dirty_db')).default(this.dbSettings);
        case 'dirtygit':
            return new (await import('./databases/dirty_git_db')).default(this.dbSettings);
        case 'elasticsearch':
            return new (await import('./databases/elasticsearch_db')).default(this.dbSettings);
        case 'memory':
            return new (await import('./databases/memory_db')).default(this.dbSettings);
        case 'mock':
            return new (await import('./databases/mock_db')).default(this.dbSettings);
        case 'mssql':
            return new (await import('./databases/mssql_db')).default(this.dbSettings);
        case 'postgrespool':
            return new (await import('./databases/postgrespool_db')).default(this.dbSettings);
        case 'rethink':
            return new (await import('./databases/rethink_db')).default(this.dbSettings);
        case 'couch':
            return new (await import('./databases/couch_db')).default(this.dbSettings);
        case 'surrealdb':
            return new (await import('./databases/surrealdb_db')).default(this.dbSettings);
        default:
            throw new Error('Invalid database type');
    }
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
    if (!cbDb || !cbDb.flush === undefined) return null;
    if (callback != null) { // @ts-ignore
      return cbDb.flush.call(this.db, callback);
    }
    return this.db.flush();
  }

  /**
   * @param key
   * @param callback - Deprecated. Node-style callback. If null, a Promise is returned.
   */
  get(key:string, callback = null) {
    if (callback != null) { // @ts-ignore
      return cbDb.get.call(this.db, key, callback);
    }
    return this.db.get(key);
  }

  /**
   * @param key
   * @param notKey
   * @param callback - Deprecated. Node-style callback. If null, a Promise is returned.
   */
  findKeys(key:string, notKey?:string, callback = null) {
    if (callback != null) { // @ts-ignore
      return cbDb.findKeys.call(this.db, key, notKey, callback);
    }
    return this.db.findKeys(key, notKey);
  }

  /**
   * Removes an entry from the database if present.
   *
   * @param key
   * @param cb Deprecated. Node-style callback. Called when the write has been committed to the
   *     underlying database driver. If null, a Promise is returned.
   * @param deprecated Deprecated callback that is called just after cb. Ignored if cb is null.
   */
  remove(key:string, cb = null, deprecated = null) {
    if (cb != null) { // @ts-ignore
      return cbDb.remove.call(this.db, key, makeDoneCallback(cb, deprecated));
    }
    return this.db.remove(key);
  }

  /**
   * Adds or changes the value of an entry.
   *
   * @param key
   * @param value
   * @param cb Deprecated. Node-style callback. Called when the write has been committed to the
   *     underlying database driver. If null, a Promise is returned.
   * @param deprecated Deprecated callback that is called just after cb. Ignored if cb is null.
   */
  set(key:string, value:any, cb = null, deprecated = null) {
    if (cb != null) { // @ts-ignore
      return cbDb.set.call(this.db, key, value, makeDoneCallback(cb, deprecated));
    }
    return this.db.set(key, value);
  }

  /**
   * @param key
   * @param sub
   * @param callback - Deprecated. Node-style callback. If null, a Promise is returned.
   */
  getSub(key:string, sub: string[], callback: Function|null = null) {
    if (callback != null) {
      return cbDb.getSub.call(this.db, key, sub, callback);
    }
    return this.db.getSub(key, sub);
  }

  /**
   * Adds or changes a subvalue of an entry.
   *
   * @param key
   * @param sub
   * @param value
   * @param cb Deprecated. Node-style callback. Called when the write has been committed to the
   *     underlying database driver. If null, a Promise is returned.
   * @param deprecated Deprecated callback that is called just after cb. Ignored if cb is null.
   */
  setSub(key:string, sub:string, value:string, cb:Function|null = null, deprecated: Function|null = null) {
    if (cb != null) {
      // @ts-ignore
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
  close(callback:Function|null = null) {
    if (callback != null) { // @ts-ignore
      return cbDb.close.call(this.db, callback);
    }
    return this.db.close();
  }
};

/**
 * Deprecated synonym of Database.
 */
export default Database;
