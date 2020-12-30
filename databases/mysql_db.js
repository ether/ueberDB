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

const AbstractDatabase = require('../lib/AbstractDatabase');
const mysql = require('mysql');
const util = require('util');

exports.Database = class extends AbstractDatabase {
  constructor(settings) {
    super();
    this.logger = console;
    this._mysqlSettings = {
      charset: 'utf8mb4', // temp hack needs a proper fix..
      ...settings,
    };
    this.settings = {
      engine: 'InnoDB',
      // Limit the query size to avoid timeouts or other failures.
      bulkLimit: 100,
      json: true,
      queryTimeout: 60000,
    };
    this._pool = null; // Initialized in init();
  }

  get isAsync() { return true; }

  async _query(options) {
    try {
      return await new Promise((resolve, reject) => {
        options = {timeout: this.settings.queryTimeout, ...options};
        this._pool.query(options, (err, ...args) => err != null ? reject(err) : resolve(args));
      });
    } catch (err) {
      this.logger.error(`${err.fatal ? 'Fatal ' : ''}MySQL error: ${err.stack || err}`);
      throw err;
    }
  }

  async init() {
    this._pool = mysql.createPool(this._mysqlSettings);
    const {database, charset} = this._mysqlSettings;

    const sqlCreate = `${'CREATE TABLE IF NOT EXISTS `store` ( ' +
                  '`key` VARCHAR( 100 ) NOT NULL COLLATE utf8mb4_bin, ' +
                  '`value` LONGTEXT COLLATE utf8mb4_bin NOT NULL , ' +
                  'PRIMARY KEY ( `key` ) ' +
                  ') ENGINE='}${this.settings.engine} CHARSET=utf8mb4 COLLATE=utf8mb4_bin;`;

    const sqlAlter = 'ALTER TABLE store MODIFY `key` VARCHAR(100) COLLATE utf8mb4_bin;';

    await this._query({sql: sqlCreate});

    // Checks for Database charset et al
    const dbCharSet =
        'SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME ' +
        `FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${database}'`;
    let [result] = await this._query({sql: dbCharSet});

    result = JSON.parse(JSON.stringify(result));
    if (result[0].DEFAULT_CHARACTER_SET_NAME !== charset) {
      this.logger.error(`Database is not configured with charset ${charset} -- ` +
                        'This may lead to crashes when certain characters are pasted in pads');
      this.logger.log(result[0], charset);
    }

    if (result[0].DEFAULT_COLLATION_NAME.indexOf(charset) === -1) {
      this.logger.error(
          `Database is not configured with collation name that includes ${charset} -- ` +
            'This may lead to crashes when certain characters are pasted in pads');
      this.logger.log(result[0], charset, result[0].DEFAULT_COLLATION_NAME);
    }

    const tableCharSet =
        'SELECT CCSA.character_set_name AS character_set_name ' +
        'FROM information_schema.`TABLES` ' +
        'T,information_schema.`COLLATION_CHARACTER_SET_APPLICABILITY` CCSA ' +
        'WHERE CCSA.collation_name = T.table_collation ' +
        `AND T.table_schema = '${database}' ` +
        "AND T.table_name = 'store'";
    [result] = await this._query({sql: tableCharSet});
    if (!result[0]) {
      this.logger.warn('Data has no character_set_name value -- ' +
                       'This may lead to crashes when certain characters are pasted in pads');
    }
    if (result[0] && (result[0].character_set_name !== charset)) {
      this.logger.error(`table is not configured with charset ${charset} -- ` +
                        'This may lead to crashes when certain characters are pasted in pads');
      this.logger.log(result[0], charset);
    }

    // check migration level, alter if not migrated
    const level = await this.get('MYSQL_MIGRATION_LEVEL');

    if (level !== '1') {
      await this._query({sql: sqlAlter});
      await this.set('MYSQL_MIGRATION_LEVEL', '1');
    }
  }

  async get(key) {
    const [results] = await this._query({
      sql: 'SELECT `value` FROM `store` WHERE `key` = ? AND BINARY `key` = ?',
      values: [key, key],
    });
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
    const [results] = await this._query({sql: query, values: params});
    return results.map((val) => val.key);
  }

  async set(key, value) {
    if (key.length > 100) throw new Error('Your Key can only be 100 chars');
    await this._query({sql: 'REPLACE INTO `store` VALUES (?,?)', values: [key, value]});
  }

  async remove(key) {
    await this._query({
      sql: 'DELETE FROM `store` WHERE `key` = ? AND BINARY `key` = ?',
      values: [key, key],
    });
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
        values: [replaces],
      }) : null,
      deletes.length ? this._query({
        sql: 'DELETE FROM `store` WHERE `key` IN (?) AND BINARY `key` IN (?);',
        values: [deletes, deletes],
      }) : null,
    ]);
  }

  async close() {
    await util.promisify(this._pool.end.bind(this._pool))();
  }
};
