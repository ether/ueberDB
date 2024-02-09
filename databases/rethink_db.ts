/**
 * 2016 Remi Arnaud
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

import AbstractDatabase, {Settings} from '../lib/AbstractDatabase';
import r from 'rethinkdb';
import async from 'async';
import {BulkObject} from './cassandra_db';

export default class Rethink_db extends AbstractDatabase {
  public host: string;
  public db: string;
  public port: number | string;
  public table: string;
  public connection: r.Connection | null;
  constructor(settings:Settings) {
    super(settings);
    if (!settings) settings = {};
    if (!settings.host) { settings.host = 'localhost'; }
    if (!settings.port) { settings.port = 28015; }
    if (!settings.db) { settings.db = 'test'; }
    if (!settings.table) { settings.table = 'test'; }

    this.host = settings.host;
    this.db = settings.db;
    this.port = settings.port;
    this.table = settings.table;
    this.connection = null;
  }

  init(callback: (p: any, cursor: any)=>{}) {
    // @ts-ignore
    r.connect(this, (err, conn) => {
      if (err) throw err;
      this.connection = conn;

      r.table(this.table).run(this.connection, (err, cursor) => {
        if (err) {
          // assuming table does not exists
          // @ts-ignore
          r.tableCreate(this.table).run(this.connection, callback);
        } else if (callback) { callback(null, cursor); }
      });
    });
  }

  get(key:string, callback: (err: Error, p: any)=>{}) {
    // @ts-ignore
    r.table(this.table).get(key).run(this.connection, (err, item) => {
      // @ts-ignore
      callback(err, (item ? item.content : item));
    });
  }

  findKeys(key:string, notKey:string, callback:()=>{}) {
    const keys = [];
    const regex = this.createFindRegex(key, notKey);
    // @ts-ignore
    r.filter((item) => {
      if (item.id.search(regex) !== -1) {
        keys.push(item.id);
      }
    }).run(this.connection, callback);
  }

  set(key:string, value:string, callback:()=>{}) {
    r.table(this.table)
        .insert({id: key, content: value}, {conflict: 'replace'})
        .run(this.connection as r.Connection, callback);
  }

  doBulk(bulk: BulkObject[], callback: ()=>{}) {
    const _in: any[] = [];
    const _out: string | string[] | r.Expression<any> = [];

    for (const i in bulk) {
      if (bulk[i].type === 'set') {
        _in.push({id: bulk[i].key, content: bulk[i].value});
      } else if (bulk[i].type === 'remove') {
        _out.push(bulk[i].key);
      }
    }

    async.parallel([
      (cb) => { // @ts-ignore
        r.table(this.table).insert(_in, {conflict: 'replace'}).run(this.connection, cb);
      },
      (cb) => { // @ts-ignore
        r.table(this.table).getAll(_out).delete().run(this.connection, cb);
      },
    ], callback);
  }

  remove(key:string, callback:()=>{}) {
    // @ts-ignore
    r.table(this.table).get(key).delete().run(this.connection, callback);
  }

  close(callback:()=>{}) {
    if (this.connection) { this.connection.close(callback); }
  }
};
