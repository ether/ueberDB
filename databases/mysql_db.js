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

const util = require('util');

exports.Database = class {
  constructor(settings) {
    // temp hack needs a proper fix..
    if (settings && !settings.charset) settings.charset = 'utf8mb4';

    this.db = require('mysql').createConnection(settings);

    this.settings = settings;

    if (this.settings.host != null) this.db.host = this.settings.host;

    if (this.settings.port != null) this.db.port = this.settings.port;

    if (this.settings.user != null) this.db.user = this.settings.user;

    if (this.settings.password != null) this.db.password = this.settings.password;

    if (this.settings.database != null) this.db.database = this.settings.database;

    if (this.settings.charset != null) this.db.charset = this.settings.charset;

    this.settings.engine = 'InnoDB';
    // Limit the query size to avoid timeouts or other failures.
    this.settings.bulkLimit = 100;
    this.settings.json = true;
  }

  get isAsync() { return true; }

  async _query(...args) {
    return await new Promise((resolve, reject) => {
      this.db.query(...args, (err, ...args) => err != null ? reject(err) : resolve(args));
    });
  }

  clearPing() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  schedulePing() {
    this.clearPing();

    this.interval = setInterval(() => {
      this.db.query({
        sql: 'SELECT 1',
        timeout: 60000,
      });
    }, 10000);
  }

  async init() {
    const db = this.db;

    const sqlCreate = `${'CREATE TABLE IF NOT EXISTS `store` ( ' +
                  '`key` VARCHAR( 100 ) NOT NULL COLLATE utf8mb4_bin, ' +
                  '`value` LONGTEXT COLLATE utf8mb4_bin NOT NULL , ' +
                  'PRIMARY KEY ( `key` ) ' +
                  ') ENGINE='}${this.settings.engine} CHARSET=utf8mb4 COLLATE=utf8mb4_bin;`;

    const sqlAlter = 'ALTER TABLE store MODIFY `key` VARCHAR(100) COLLATE utf8mb4_bin;';

    await this._query({
      sql: sqlCreate,
      timeout: 60000,
    }, []);

    // Checks for Database charset et al
    const dbCharSet =
        'SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME ' +
        `FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${db.database}'`;
    let [result] = await this._query({
      sql: dbCharSet,
      timeout: 60000,
    });

    result = JSON.parse(JSON.stringify(result));
    if (result[0].DEFAULT_CHARACTER_SET_NAME !== db.charset) {
      console.error(`Database is not configured with charset ${db.charset} -- ` +
                    'This may lead to crashes when certain characters are pasted in pads');
      console.log(result[0], db.charset);
    }

    if (result[0].DEFAULT_COLLATION_NAME.indexOf(db.charset) === -1) {
      console.error(
          `Database is not configured with collation name that includes ${db.charset} -- ` +
            'This may lead to crashes when certain characters are pasted in pads');
      console.log(result[0], db.charset, result[0].DEFAULT_COLLATION_NAME);
    }

    const tableCharSet =
        'SELECT CCSA.character_set_name AS character_set_name ' +
        'FROM information_schema.`TABLES` ' +
        'T,information_schema.`COLLATION_CHARACTER_SET_APPLICABILITY` CCSA ' +
        'WHERE CCSA.collation_name = T.table_collation ' +
        `AND T.table_schema = '${db.database}' ` +
        "AND T.table_name = 'store'";
    [result] = await this._query({
      sql: tableCharSet,
      timeout: 60000,
    });
    if (!result[0]) {
      console.warn('Data has no character_set_name value -- ' +
                   'This may lead to crashes when certain characters are pasted in pads');
    }
    if (result[0] && (result[0].character_set_name !== db.charset)) {
      console.error(`table is not configured with charset ${db.charset} -- ` +
                    'This may lead to crashes when certain characters are pasted in pads');
      console.log(result[0], db.charset);
    }

    // check migration level, alter if not migrated
    const level = await this.get('MYSQL_MIGRATION_LEVEL');

    if (level !== '1') {
      await this._query({
        sql: sqlAlter,
        timeout: 60000,
      }, []);
      await this.set('MYSQL_MIGRATION_LEVEL', '1');
    }

    this.schedulePing();
  }

  async get(key) {
    const [results] = await this._query({
      sql: 'SELECT `value` FROM `store` WHERE `key` = ? AND BINARY `key` = ?',
      timeout: 60000,
    }, [key, key]);
    this.schedulePing();
    return results.length === 1 ? results[0].value : null;
  }

  async findKeys(key, notKey) {
    let query = 'SELECT `key` FROM `store` WHERE `key` LIKE ?';
    const params = [];

    // desired keys are key, e.g. pad:%
    key = key.replace(/\*/g, '%');
    params.push(key);

    if (notKey != null) {
      // not desired keys are notKey, e.g. %:%:%
      notKey = notKey.replace(/\*/g, '%');
      query += ' AND `key` NOT LIKE ?';
      params.push(notKey);
    }
    const [results] = await this._query({
      sql: query,
      timeout: 60000,
    }, params);
    this.schedulePing();
    return results.map((val) => val.key);
  }

  async set(key, value) {
    if (key.length > 100) throw new Error('Your Key can only be 100 chars');
    await this._query({
      sql: 'REPLACE INTO `store` VALUES (?,?)',
      timeout: 60000,
    }, [key, value]);
    this.schedulePing();
  }

  async remove(key) {
    await this._query({
      sql: 'DELETE FROM `store` WHERE `key` = ? AND BINARY `key` = ?',
      timeout: 60000,
    }, [key, key]);
    this.schedulePing();
  }

  async doBulk(bulk) {
    const replaces = [];
    const deletes = [];
    for (const op of bulk) {
      switch (op.type) {
        case 'set': replaces.push([op.key, op.value]); break;
        case 'remove': deletes.push(op.key); break;
        default: throw new Error(`unknown op type: ${op.type}`);
      }
    }
    await Promise.all([
      replaces.length ? this._query({
        sql: 'REPLACE INTO `store` VALUES ?;',
        timeout: 60000,
      }, [replaces]) : null,
      deletes.length ? this._query({
        sql: 'DELETE FROM `store` WHERE `key` IN (?) AND BINARY `key` IN (?);',
        timeout: 60000,
      }, [deletes, deletes]) : null,
    ]);
    this.schedulePing();
  }

  async close() {
    this.clearPing();
    await util.promisify(this.db.end.bind(this.db))();
  }
};
