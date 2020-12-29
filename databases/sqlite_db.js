'use strict';
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

let sqlite3;
try {
  sqlite3 = require('sqlite3');
} catch (err) {
  throw new Error(
      'sqlite3 not found. It was removed from ueberdb\'s dependencies because it requires ' +
      'compilation which fails on several systems. If you still want to use sqlite, run ' +
      '"npm install sqlite3" in your etherpad-lite root folder.');
}

const util = require('util');

const escape = (val) => `'${val.replace(/'/g, "''")}'`;

exports.Database = function (settings) {
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
};

exports.Database.prototype.init = function (callback) {
  util.callbackify(async () => {
    this.db = await new Promise((resolve, reject) => {
      new sqlite3.Database(this.settings.filename, function (err) {
        if (err != null) return reject(err);
        // The use of `this` relies on an undocumented feature of sqlite3:
        // https://github.com/mapbox/node-sqlite3/issues/1408
        resolve(this);
      });
    });
    await util.promisify(this.db.run.bind(this.db))(
        'CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value TEXT)');
  })(callback);
};

exports.Database.prototype.get = function (key, callback) {
  this.db.get('SELECT value FROM store WHERE key = ?', key, (err, row) => {
    callback(err, row ? row.value : null);
  });
};

exports.Database.prototype.findKeys = function (key, notKey, callback) {
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

  this.db.all(query, params, (err, results) => {
    const value = [];

    if (!err && Object.keys(results).length > 0) {
      results.forEach((val) => {
        value.push(val.key);
      });
    }

    callback(err, value);
  });
};

exports.Database.prototype.set = function (key, value, callback) {
  this.db.run('REPLACE INTO store VALUES (?,?)', key, value, callback);
};

exports.Database.prototype.remove = function (key, callback) {
  this.db.run('DELETE FROM store WHERE key = ?', key, callback);
};

exports.Database.prototype.doBulk = function (bulk, callback) {
  let sql = 'BEGIN TRANSACTION;\n';
  for (const i in bulk) {
    if (bulk[i].type === 'set') {
      sql += `REPLACE INTO store VALUES (${escape(bulk[i].key)}, ${escape(bulk[i].value)});\n`;
    } else if (bulk[i].type === 'remove') {
      sql += `DELETE FROM store WHERE key = ${escape(bulk[i].key)};\n`;
    }
  }
  sql += 'END TRANSACTION;';

  this.db.exec(sql, (err) => {
    if (err) {
      console.error('ERROR WITH SQL: ');
      console.error(sql);
    }

    callback(err);
  });
};

exports.Database.prototype.close = function (callback) {
  this.db.close(callback);
};
