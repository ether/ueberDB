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
import Cassandra_db from './databases/cassandra_db'
import Couch_db from './databases/couch_db'
import Dirty_db from './databases/dirty_db'
import Dirty_git_db from './databases/dirty_git_db'
import Elasticsearch_db from './databases/elasticsearch_db'
import MemoryDB from './databases/memory_db'
import Mock_db from './databases/mock_db'
import Mongodb_db from './databases/mongodb_db'
import MSSQL from './databases/mssql_db'
import Mysql_db from './databases/mysql_db'
import Postgres_db from './databases/postgres_db'
import Postgrespool_db from './databases/postgrespool_db'
import RedisDB from './databases/redis_db'
import Rethink_db from './databases/rethink_db'
import SQLiteDB from './databases/sqlite_db'
import SurrealDB from './databases/surrealdb_db'
import Rusty_db from "./databases/rusty_db";

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
    const db:any = this.initDB();
    db.logger = this.logger;
    this.db = new DatabaseCache(db, this.wrapperSettings, this.logger);
    this.metrics = this.db.metrics;
    if (callback != null) {
      return cbDb.init.call(this.db);
    }
    return this.db.init();
  }

  initDB(){
    switch (this.type){
        case 'mysql':
            return new Mysql_db(this.dbSettings);
        case 'postgres':
          return new Postgres_db(this.dbSettings);
        case 'sqlite':
          return new SQLiteDB(this.dbSettings);
        case 'rustydb':
            return new Rusty_db(this.dbSettings);
        case 'mongodb':
          return new Mongodb_db(this.dbSettings);
        case 'redis':
          return new RedisDB(this.dbSettings);
        case 'cassandra':
          return new Cassandra_db(this.dbSettings);
        case 'dirty':
          return new Dirty_db(this.dbSettings);
        case 'dirtygit':
            return new Dirty_git_db(this.dbSettings);
        case 'elasticsearch':
            return new Elasticsearch_db(this.dbSettings);
        case 'memory':
            return new MemoryDB(this.dbSettings);
        case 'mock':
            return new Mock_db(this.dbSettings);
        case 'mssql':
            return new MSSQL(this.dbSettings);
        case 'postgrespool':
            return new Postgrespool_db(this.dbSettings);
        case 'rethink':
            return new Rethink_db(this.dbSettings);
        case 'couch':
            return new Couch_db(this.dbSettings);
        case 'surrealdb':
            return new SurrealDB(this.dbSettings);
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
