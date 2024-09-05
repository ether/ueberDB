'use strict';
import {BulkObject} from "./cassandra_db";
import AbstractDatabase, {Settings} from "../lib/AbstractDatabase";

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

const escape = (val:string) => `'${val.replace(/'/g, "''")}'`;

type RequestVal = {
  value: string;
}

export default class SQLiteDB extends AbstractDatabase {
  public db: any|null;
  constructor(settings:Settings) {
    super(settings);
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

  init(callback: Function) {
    let SQLITEDB
    try {
      SQLITEDB = require('better-sqlite3');
    } catch (err) {
      throw new Error(
          'better-sqlite3 not found. It was removed from ueberdb\'s dependencies because it requires ' +
          'compilation which fails on several systems. If you still want to use sqlite, run ' +
          '"pnpm install better-sqlite3" in your etherpad-lite ./src directory.');
    }
    this.db = new SQLITEDB(this.settings.filename as string)
    this._query('CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value TEXT)');
    callback();
  }

  async _query(sql:string, params = []) {
    // It is unclear how util.promisify() deals with variadic functions, so it is not used here.
      // According to sqlite3's documentation, .run() method (and maybe .all() and .get(); the
      // documentation is unclear) might call the callback multiple times. That's OK -- ECMAScript
      // guarantees that it is safe to call a Promise executor's resolve and reject functions
      // multiple times. The subsequent calls are ignored, except Node.js's 'process' object emits a
      // 'multipleResolves' event to aid in debugging.
    return this.db!.prepare(sql).run(params)
  }



  get(key:string, callback:Function) {
    const res = this.db!.prepare('SELECT value FROM store WHERE key = ?').get(key) as RequestVal
    callback(null, res ? res.value : null)
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
    const res = this.db!.prepare(query).all(params).map((row:any) => row.key)

    callback(null, res);
  }

  set(key:string, value:string, callback:Function) {
    const res = this.db!.prepare('REPLACE INTO store VALUES (?,?)').run(key, value);
    res.changes === 0 ? callback(null, null) : callback(null, res.lastInsertRowid)
  }

  remove(key:string, callback:Function) {
    this.db!.prepare('DELETE FROM store WHERE key = ?').run(key)
    callback(null, null)
  }

  handleBulk(bulk:BulkObject){
    let statement = '';
    if (bulk.type === 'set') {
      statement = `REPLACE INTO store VALUES (${escape(bulk.key)}, ${escape(bulk.value as string)});`;
    } else if (bulk.type === 'remove') {
      statement = `DELETE FROM store WHERE key = ${escape(bulk.key)};\n`;
    }
    return statement
  }
  doBulk(bulk:BulkObject[], callback:Function) {
    const transaction = this.db!.transaction((bulk:BulkObject[])=>{
      bulk.forEach(b=>{
        let sql = this.handleBulk(b)
        this.db!.prepare(sql).run()
      })
    });
    transaction(bulk);
    callback();
  }

  close(callback: Function) {
    callback()
    this.db!.close();
  }
};
