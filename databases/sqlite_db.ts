'use strict';
import {BulkObject} from "./cassandra_db";
import {Settings} from "../lib/AbstractDatabase";

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

import  {Database as SQDB} from 'sqlite3'

import AbstractDatabase from '../lib/AbstractDatabase';
import util from 'util';

const escape = (val:string) => `'${val.replace(/'/g, "''")}'`;

export const Database = class SQLiteDB extends AbstractDatabase {
  private db: SQDB|null;
  constructor(settings:Settings) {
    super();
    this.db = null;

    if (!settings || !settings.filename) {
      settings = {filename: ':memory:'};
    }

    this.settings = settings;

    // set settings for the dbWrapper
    if (settings.filename === ':memory:') {
      this.settings.cache = 0;
      this.settings.writeInterval = 0;
      this.settings.json = true;
    } else {
      this.settings.cache = 1000;
      this.settings.writeInterval = 100;
      this.settings.json = true;
    }
  }

  init(callback:Function) {
    util.callbackify(async () => {
      this.db = new SQDB(this.settings.filename as string)
      await this._query('CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value TEXT)');
      // @ts-ignore
    })(callback);
  }

  async _query(sql:string, params = []) {
    // It is unclear how util.promisify() deals with variadic functions, so it is not used here.
    return await new Promise((resolve, reject) => {
      // According to sqlite3's documentation, .run() method (and maybe .all() and .get(); the
      // documentation is unclear) might call the callback multiple times. That's OK -- ECMAScript
      // guarantees that it is safe to call a Promise executor's resolve and reject functions
      // multiple times. The subsequent calls are ignored, except Node.js's 'process' object emits a
      // 'multipleResolves' event to aid in debugging.
      this.db&&this.db.all(sql, params, (err:Error, rows:any) => {
        if (err != null) return reject(err);
        resolve(rows);
      });
    });
  }

  // Temporary callbackified version of _query. This will be removed once all database objects are
  // asyncified.
  _queryCb(sql: string, params: string[], callback: Function) {
    // It is unclear how util.callbackify() handles optional parameters, so it is not used here.
    const p = this._query(sql, params as []);
    if (callback) p.then((rows) => callback(null, rows), (err) => callback(err || new Error(err)));
  }



  get(key:string, callback:Function) {
    this._queryCb(
        'SELECT value FROM store WHERE key = ?', [key],
        (err:Error, rows:any) => callback(err, err == null && rows && rows.length ? rows[0].value : null));
  }

  findKeys(key:string, notKey:string, callback:Function) {
    let query = 'SELECT key FROM store WHERE key LIKE ?';
    const params = [];
    // desired keys are %key:%, e.g. pad:%
    key = key.replace(/\*/g, '%');
    params.push(key);

    if (notKey != null) {
      // not desired keys are notKey:%, e.g. %:%:%
      notKey = notKey.replace(/\*/g, '%');
      query += ' AND key NOT LIKE ?';
      params.push(notKey);
    }

    this._queryCb(query, params, (err: Error, results: { val: string, key: string }[]) => {
      const value: string[] = [];

      if (!err && Object.keys(results).length > 0) {
        results.forEach((val) => {
          value.push(val.key);
        });
      }

      callback(err, value);
    });
  }

  set(key:string, value:string, callback:Function) {
    this._queryCb('REPLACE INTO store VALUES (?,?)', [key, value], callback);
  }

  remove(key:string, callback:Function) {
    this._queryCb('DELETE FROM store WHERE key = ?', [key], callback);
  }

  doBulk(bulk:BulkObject[], callback:Function) {
    let sql = 'BEGIN TRANSACTION;\n';
    for (const i in bulk) {
      if (bulk[i].type === 'set') {
        sql += `REPLACE INTO store VALUES (${escape(bulk[i].key)}, ${escape(bulk[i].value as string)});\n`;
      } else if (bulk[i].type === 'remove') {
        sql += `DELETE FROM store WHERE key = ${escape(bulk[i].key)};\n`;
      }
    }
    sql += 'END TRANSACTION;';

    this.db&&this.db.exec(sql, (err:any) => {
      if (err) {
        console.error('ERROR WITH SQL: ');
        console.error(sql);
      }

      callback(err);
    });
  }

  close(callback: Function) {
    callback()
    this.db&&this.db.close((err:any) => callback(err));
  }
};
