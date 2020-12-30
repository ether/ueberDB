'use strict';
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

const AbstractDatabase = require('../lib/AbstractDatabase');
const r = require('rethinkdb');
const async = require('async');

exports.Database = class extends AbstractDatabase {
  constructor(settings) {
    super();
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

  init(callback) {
    r.connect(this, (err, conn) => {
      if (err) throw err;
      this.connection = conn;

      r.table(this.table).run(this.connection, (err, cursor) => {
        if (err) {
          // assuming table does not exists
          r.tableCreate(this.table).run(this.connection, callback);
        } else if (callback) { callback(null, cursor); }
      });
    });
  }

  get(key, callback) {
    r.table(this.table).get(key).run(this.connection, (err, item) => {
      callback(err, (item ? item.content : item));
    });
  }

  findKeys(key, notKey, callback) {
    const keys = [];
    const regex = this.createFindRegex(key, notKey);
    r.filter((item) => {
      if (item.id.search(regex) !== -1) {
        keys.push(item.id);
      }
    }).run(this.connection, callback);
  }

  set(key, value, callback) {
    r.table(this.table)
        .insert({id: key, content: value}, {conflict: 'replace'})
        .run(this.connection, callback);
  }

  doBulk(bulk, callback) {
    const _in = [];
    const _out = [];

    for (const i in bulk) {
      if (bulk[i].type === 'set') {
        _in.push({id: bulk[i].key, content: bulk[i].value});
      } else if (bulk[i].type === 'remove') {
        _out.push(bulk[i].key);
      }
    }
    async.parallel([
      (cb) => { r.table(this.table).insert(_in, {conflict: 'replace'}).run(this.connection, cb); },
      (cb) => { r.table(this.table).getAll(_out).delete().run(this.connection, cb); },
    ], callback);
  }

  remove(key, callback) {
    r.table(this.table).get(key).delete().run(this.connection, callback);
  }

  close(callback) {
    this.connection.close(callback);
  }
};
