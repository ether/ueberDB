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

const r = require('rethinkdb');
const async = require('async');

exports.database = function (settings) {
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
};

exports.database.prototype.init = function (callback) {
  const that = this;
  r.connect(that, (err, conn) => {
    if (err) throw err;
    that.connection = conn;

    r.table(that.table).run(that.connection, (err, cursor) => {
      if (err) {
        // assuming table does not exists
        r.tableCreate(that.table).run(that.connection, callback);
      } else if (callback) { callback(null, cursor); }
    });
  });
};

exports.database.prototype.get = function (key, callback) {
  const that = this;
  r.table(that.table).get(key).run(that.connection, (err, item) => {
    callback(err, (item ? item.content : item));
  });
};

exports.database.prototype.findKeys = function (key, notKey, callback) {
  const keys = [];
  const regex = this.createFindRegex(key, notKey);
  const that = this;
  r.filter((item) => {
    if (item.id.search(regex) != -1) {
      keys.push(item.id);
    }
  }).run(that.connection, callback);
};

exports.database.prototype.set = function (key, value, callback) {
  const that = this;
  r.table(that.table).insert({id: key, content: value}, {conflict: 'replace'}).run(that.connection, callback);
};

exports.database.prototype.doBulk = function (bulk, callback) {
  const that = this;
  const _in = [];
  const _out = [];

  for (const i in bulk) {
    if (bulk[i].type == 'set') {
      _in.push({id: bulk[i].key, content: bulk[i].value});
    } else if (bulk[i].type == 'remove') {
      _out.push(bulk[i].key);
    }
  }
  async.parallel([
    function (cb) { r.table(that.table).insert(_in, {conflict: 'replace'}).run(that.connection, cb); },
    function (cb) { r.table(that.table).getAll(_out).delete().run(that.connection, cb); },
  ], callback);
};
exports.database.prototype.remove = function (key, callback) {
  const that = this;
  r.table(that.table).get(key).delete().run(that.connection, callback);
};

exports.database.prototype.close = function (callback) {
  this.connection.close(callback);
};
