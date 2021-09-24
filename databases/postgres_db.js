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
const async = require('async');
const pg = require('pg');

exports.Database = class extends AbstractDatabase {
  constructor(settings) {
    super();
    if (typeof settings === 'string') settings = {connectionString: settings};
    this.settings = settings;

    this.settings.cache = settings.cache || 1000;
    this.settings.writeInterval = 100;
    this.settings.json = true;

    // Pool specific defaults
    this.settings.max = this.settings.max || 20;
    this.settings.min = this.settings.min || 4;
    this.settings.idleTimeoutMillis = this.settings.idleTimeoutMillis || 1000;

    this.db = new pg.Pool(this.settings);
  }

  init(callback) {
    const testTableExists = "SELECT 1 as exists FROM pg_tables WHERE tablename = 'store'";

    const createTable = 'CREATE TABLE IF NOT EXISTS store (' +
                        '"key" character varying(100) NOT NULL, ' +
                        '"value" text NOT NULL, ' +
                        'CONSTRAINT store_pkey PRIMARY KEY (key))';

    // this variable will be given a value depending on the result of the
    // feature detection
    this.upsertStatement = null;

    /*
     * - Detects if this Postgres version supports INSERT .. ON CONFLICT
     *   UPDATE (PostgreSQL >= 9.5 and CockroachDB)
     * - If upsert is not supported natively, creates in the DB a pl/pgsql
     *   function that emulates it
     * - Performs a side effect, setting this.upsertStatement to the sql
     *   statement that needs to be used, based on the detection result
     * - calls the callback
     */
    const detectUpsertMethod = (callback) => {
      const upsertViaFunction = 'SELECT ueberdb_insert_or_update($1,$2)';
      const upsertNatively =
          'INSERT INTO store(key, value) VALUES ($1, $2) ' +
          'ON CONFLICT (key) DO UPDATE SET value = excluded.value';
      const createFunc =
          'CREATE OR REPLACE FUNCTION ueberdb_insert_or_update(character varying, text) ' +
          'RETURNS void AS $$ ' +
          'BEGIN ' +
          '  IF EXISTS( SELECT * FROM store WHERE key = $1 ) THEN ' +
          '    UPDATE store SET value = $2 WHERE key = $1; ' +
          '  ELSE ' +
          '    INSERT INTO store(key,value) VALUES( $1, $2 ); ' +
          '  END IF; ' +
          '  RETURN; ' +
          'END; ' +
          '$$ LANGUAGE plpgsql;';

      const testNativeUpsert = `EXPLAIN ${upsertNatively}`;

      this.db.query(testNativeUpsert, ['test-key', 'test-value'], (err) => {
        if (err) {
          // the UPSERT statement failed: we will have to emulate it via
          // an sql function
          this.upsertStatement = upsertViaFunction;

          // actually create the emulation function
          this.db.query(createFunc, [], callback);

          return;
        }

        // if we get here, the EXPLAIN UPSERT succeeded, and we can use a
        // native UPSERT
        this.upsertStatement = upsertNatively;
        callback();
      });
    };

    this.db.query(testTableExists, (err, result) => {
      if (err != null) return callback(err);
      if (result.rows.length === 0) {
        this.db.query(createTable, (err) => {
          if (err != null) return callback(err);
          detectUpsertMethod(callback);
        });
      } else {
        detectUpsertMethod(callback);
      }
    });
  }

  get(key, callback) {
    this.db.query('SELECT value FROM store WHERE key=$1', [key], (err, results) => {
      let value = null;

      if (!err && results.rows.length === 1) {
        value = results.rows[0].value;
      }

      callback(err, value);
    });
  }

  findKeys(key, notKey, callback) {
    let query = 'SELECT key FROM store WHERE key LIKE $1';
    const params = [];
    // desired keys are %key:%, e.g. pad:%
    key = key.replace(/\*/g, '%');
    params.push(key);

    if (notKey != null) {
      // not desired keys are notKey:%, e.g. %:%:%
      notKey = notKey.replace(/\*/g, '%');
      query += ' AND key NOT LIKE $2';
      params.push(notKey);
    }
    this.db.query(query, params, (err, results) => {
      const value = [];

      if (!err && results.rows.length > 0) {
        results.rows.forEach((val) => {
          value.push(val.key);
        });
      }

      callback(err, value);
    });
  }

  set(key, value, callback) {
    if (key.length > 100) {
      callback('Your Key can only be 100 chars');
    } else {
      this.db.query(this.upsertStatement, [key, value], callback);
    }
  }

  remove(key, callback) {
    this.db.query('DELETE FROM store WHERE key=$1', [key], callback);
  }

  doBulk(bulk, callback) {
    const replaceVALs = [];
    let removeSQL = 'DELETE FROM store WHERE key IN (';
    const removeVALs = [];

    let removeCount = 0;

    for (const i in bulk) {
      if (bulk[i].type === 'set') {
        replaceVALs.push([bulk[i].key, bulk[i].value]);
      } else if (bulk[i].type === 'remove') {
        if (removeCount !== 0) removeSQL += ',';
        removeCount += 1;

        removeSQL += `$${removeCount}`;
        removeVALs.push(bulk[i].key);
      }
    }

    removeSQL += ');';

    const functions = replaceVALs.map((v) => (cb) => this.db.query(this.upsertStatement, v, cb));

    const removeFunction = (callback) => {
      if (!removeVALs.length < 1) this.db.query(removeSQL, removeVALs, callback);
      else callback();
    };
    functions.push(removeFunction);

    async.parallel(functions, callback);
  }

  close(callback) {
    this.db.end(callback);
  }
};
