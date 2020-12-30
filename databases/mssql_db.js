'use strict';
/* eslint new-cap: ["error", {"capIsNewExceptions": ["mssql.NVarChar"]}] */

/**
 * 2019 - exspecto@gmail.com
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
 *
 *
 * Note: This requires MS SQL Server >= 2008 due to the usage of the MERGE statement
 *
 */

const AbstractDatabase = require('../lib/AbstractDatabase');
const async = require('async');
const mssql = require('mssql');

exports.Database = class extends AbstractDatabase {
  constructor(settings) {
    super();
    settings = settings || {};

    if (settings.json != null) {
      settings.parseJSON = settings.json;
    }

    // set the request timeout to 5 minutes
    settings.requestTimeout = 300000;

    settings.server = settings.host;
    this.settings = settings;

    /*
      Turning off the cache and write buffer here. You
      can reenable it, but also take a look at maxInserts in
      the doBulk function to decide how you want to split it up.
    */
    this.settings.cache = 0;
    this.settings.writeInterval = 0;
  }

  init(callback) {
    const sqlCreate =
        "IF OBJECT_ID(N'dbo.store', N'U') IS NULL" +
        '  BEGIN' +
        '    CREATE TABLE [store] (' +
        '      [key] NVARCHAR(100) PRIMARY KEY,' +
        '      [value] NTEXT NOT NULL' +
        '    );' +
        '  END';

    new mssql.ConnectionPool(this.settings).connect().then((pool) => {
      this.db = pool;

      const request = new mssql.Request(this.db);

      request.query(sqlCreate, (err) => {
        callback(err);
      });

      this.db.on('error', (err) => {
        console.log(err);
      });
    });
  }

  get(key, callback) {
    const request = new mssql.Request(this.db);

    request.input('key', mssql.NVarChar(100), key);

    request.query('SELECT [value] FROM [store] WHERE [key] = @key', (err, results) => {
      let value = null;

      if (!err && results.rowsAffected[0] === 1) {
        value = results.recordset[0].value;
      }

      callback(err, value);
    });
  }

  findKeys(key, notKey, callback) {
    const request = new mssql.Request(this.db);
    let query = 'SELECT [key] FROM [store] WHERE [key] LIKE @key';

    // desired keys are key, e.g. pad:%
    key = key.replace(/\*/g, '%');

    request.input('key', mssql.NVarChar(100), key);

    if (notKey != null) {
      // not desired keys are notKey, e.g. %:%:%
      notKey = notKey.replace(/\*/g, '%');
      request.input('notkey', mssql.NVarChar(100), notKey);
      query += ' AND [key] NOT LIKE @notkey';
    }

    request.query(query, (err, results) => {
      const value = [];

      if (!err && results.rowsAffected[0] > 0) {
        for (let i = 0; i < results.recordset.length; i++) {
          value.push(results.recordset[i].key);
        }
      }

      callback(err, value);
    });
  }

  set(key, value, callback) {
    const request = new mssql.Request(this.db);

    if (key.length > 100) {
      callback('Your Key can only be 100 chars');
    } else {
      const query =
          'MERGE [store] t USING (SELECT @key [key], @value [value]) s' +
          ' ON t.[key] = s.[key]' +
          ' WHEN MATCHED AND s.[value] IS NOT NULL THEN UPDATE SET t.[value] = s.[value]' +
          ' WHEN NOT MATCHED THEN INSERT ([key], [value]) VALUES (s.[key], s.[value]);';

      request.input('key', mssql.NVarChar(100), key);
      request.input('value', mssql.NText, value);

      request.query(query, (err, info) => {
        callback(err);
      });
    }
  }

  remove(key, callback) {
    const request = new mssql.Request(this.db);
    request.input('key', mssql.NVarChar(100), key);
    request.query('DELETE FROM [store] WHERE [key] = @key', callback);
  }

  doBulk(bulk, callback) {
    const maxInserts = 100;
    const request = new mssql.Request(this.db);
    let firstReplace = true;
    let firstRemove = true;
    const replacements = [];
    let removeSQL = 'DELETE FROM [store] WHERE [key] IN (';

    for (const i in bulk) {
      if (bulk[i].type === 'set') {
        if (firstReplace) {
          replacements.push('BEGIN TRANSACTION;');
          firstReplace = false;
        } else if (i % maxInserts === 0) {
          replacements.push('\nCOMMIT TRANSACTION;\nBEGIN TRANSACTION;\n');
        }

        replacements.push(
            `MERGE [store] t USING (SELECT '${bulk[i].key}' [key], '${bulk[i].value}' [value]) s`,
            'ON t.[key] = s.[key]',
            'WHEN MATCHED AND s.[value] IS NOT NULL THEN UPDATE SET t.[value] = s.[value]',
            'WHEN NOT MATCHED THEN INSERT ([key], [value]) VALUES (s.[key], s.[value]);');
      } else if (bulk[i].type === 'remove') {
        if (!firstRemove) {
          removeSQL += ',';
        }

        firstRemove = false;
        removeSQL += `'${bulk[i].key}'`;
      }
    }

    removeSQL += ');';
    replacements.push('COMMIT TRANSACTION;');

    async.parallel(
        [
          (callback) => {
            if (!firstReplace) {
              request.batch(replacements.join('\n'), (err, results) => {
                if (err) {
                  callback(err);
                }
                callback(err, results);
              });
            } else {
              callback();
            }
          },
          (callback) => {
            if (!firstRemove) {
              request.query(removeSQL, callback);
            } else {
              callback();
            }
          },
        ],
        (err, results) => {
          if (err) {
            callback(err);
          }
          callback(err, results);
        }
    );
  }

  close(callback) {
    this.db.close(callback);
  }
};
