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

import AbstractDatabase, { type Settings } from "../lib/AbstractDatabase";
import async from "async";
import * as pg from "pg";
import type { BulkObject } from "./cassandra_db";

export default class extends AbstractDatabase {
  public db: pg.Pool;
  public upsertStatement: string | null | undefined;
  constructor(settings: Settings | string) {
    super(settings as Settings);
    if (typeof settings === "string") settings = { connectionString: settings };
    this.settings = settings;

    this.settings.cache = settings.cache || 1000;
    this.settings.writeInterval = 100;
    this.settings.json = true;

    // Pool specific defaults. Use `??` (not `||`) so callers can pass an
    // explicit 0 — notably `min: 0` to keep no warm idle connections at all,
    // which is the simplest way to avoid a proxy/firewall reaping idle
    // sockets (see the keep-alive note below and ether/etherpad#7878).
    this.settings.max = this.settings.max ?? 20;
    this.settings.min = this.settings.min ?? 4;
    this.settings.idleTimeoutMillis = this.settings.idleTimeoutMillis ?? 1000;
    // Enable TCP keep-alive so the `min` warm-but-idle connections are not
    // dropped by kernel/NAT/firewall/conntrack idle-state expiry (which keys
    // off raw packet inactivity). Note this does NOT defeat an application-
    // layer proxy idle timeout such as HAProxy `timeout server`/`timeout
    // client` or pgbouncer — those count *data* inactivity and ignore the
    // empty kernel keep-alive segments, so they will still close the
    // connection (raise the proxy timeout for that; the pool reconnects
    // either way — see the error handler below). Both are overridable via
    // settings.
    // `??` so an explicit `false`/`0` is preserved but a null/undefined falls
    // back to the default (a null would otherwise reach pg.PoolConfig).
    this.settings.keepAlive = this.settings.keepAlive ?? true;
    this.settings.keepAliveInitialDelayMillis = this.settings.keepAliveInitialDelayMillis ?? 10000;
    this.db = new pg.Pool(this.settings as pg.PoolConfig);
    // A pooled client connected to a live backend can still emit an error
    // long after checkout/release (network blip, failover, or a middlebox
    // closing an idle connection). The pg Pool re-emits these on itself;
    // with no listener Node treats the EventEmitter 'error' as uncaught and
    // terminates the process. Handle it so a single dropped idle connection
    // is logged and discarded (the pool transparently reconnects) instead
    // of crashing the host application.
    this.db.on("error", (err) => {
      this.logger.error(`Postgres idle client error (connection discarded): ${err.stack || err}`);
    });
  }

  init(callback: (err: Error) => {}) {
    const testTableExists = "SELECT 1 as exists FROM pg_tables WHERE tablename = 'store'";

    const createTable =
      "CREATE TABLE IF NOT EXISTS store (" +
      '"key" character varying(100) NOT NULL, ' +
      '"value" text NOT NULL, ' +
      "CONSTRAINT store_pkey PRIMARY KEY (key))";

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
    const detectUpsertMethod = (callback: (err?: Error) => {}) => {
      const upsertViaFunction = "SELECT ueberdb_insert_or_update($1,$2)";
      const upsertNatively =
        "INSERT INTO store(key, value) VALUES ($1, $2) " +
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value";
      const createFunc =
        "CREATE OR REPLACE FUNCTION ueberdb_insert_or_update(character varying, text) " +
        "RETURNS void AS $$ " +
        "BEGIN " +
        "  IF EXISTS( SELECT * FROM store WHERE key = $1 ) THEN " +
        "    UPDATE store SET value = $2 WHERE key = $1; " +
        "  ELSE " +
        "    INSERT INTO store(key,value) VALUES( $1, $2 ); " +
        "  END IF; " +
        "  RETURN; " +
        "END; " +
        "$$ LANGUAGE plpgsql;";

      const testNativeUpsert = `EXPLAIN ${upsertNatively}`;

      this.db.query(testNativeUpsert, ["test-key", "test-value"], (err) => {
        if (err) {
          // the UPSERT statement failed: we will have to emulate it via
          // an sql function
          this.upsertStatement = upsertViaFunction;

          // actually create the emulation function
          this.db.query(createFunc, [] as string[], callback);

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
          // @ts-ignore
          detectUpsertMethod(callback);
        });
      } else {
        // @ts-ignore
        detectUpsertMethod(callback);
      }
    });
  }

  get(key: string, callback: (err: Error | null, value: any) => {}) {
    this.db.query(
      { name: "ueberdb_get", text: "SELECT value FROM store WHERE key=$1", values: [key] },
      (err, results) => {
        let value = null;

        if (!err && results.rows.length === 1) {
          value = results.rows[0].value;
        }

        callback(err, value);
      },
    );
  }

  findKeys(key: string, notKey: string, callback: (err: Error | null, value: any) => {}) {
    let query = "SELECT key FROM store WHERE key LIKE $1";
    const params = [];
    // desired keys are %key:%, e.g. pad:%
    key = key.replace(/\*/g, "%");
    params.push(key);

    if (notKey != null) {
      // not desired keys are notKey:%, e.g. %:%:%
      notKey = notKey.replace(/\*/g, "%");
      query += " AND key NOT LIKE $2";
      params.push(notKey);
    }
    this.db.query(query, params, (err, results) => {
      const value: string[] = [];

      if (!err && results.rows.length > 0) {
        results.rows.forEach((val) => {
          value.push(val.key);
        });
      }

      callback(err, value);
    });
  }

  findKeysPaged(
    key: string,
    notKey: string | null | undefined,
    options: { limit: number; after?: string },
    callback: (err: Error | null, value: string[]) => void,
  ) {
    if (!options || !Number.isInteger(options.limit) || options.limit <= 0) {
      return callback(new Error("findKeysPaged requires a positive integer limit"), []);
    }
    let query = "SELECT key FROM store WHERE key LIKE $1";
    const params: (string | number)[] = [key.replace(/\*/g, "%")];
    let n = 2;
    if (notKey != null) {
      query += ` AND key NOT LIKE $${n++}`;
      params.push(notKey.replace(/\*/g, "%"));
    }
    if (options.after != null) {
      query += ` AND key > $${n++}`;
      params.push(options.after);
    }
    query += ` ORDER BY key ASC LIMIT $${n}`;
    params.push(options.limit);
    this.db.query(query, params, (err, results) => {
      const value: string[] = [];
      if (!err && results.rows.length > 0) {
        for (const row of results.rows) value.push(row.key);
      }
      callback(err, value);
    });
  }

  set(key: string, value: string, callback: (err: Error, result: pg.QueryResult) => void) {
    if (key.length > 100) {
      const val = "" as any;
      callback(Error("Your Key can only be 100 chars"), val);
    } else if (this.upsertStatement != null) {
      const name = this.upsertStatement.startsWith("INSERT INTO store(key, value) VALUES")
        ? "ueberdb_set_native"
        : "ueberdb_set_function";
      this.db.query({ name, text: this.upsertStatement, values: [key, value] }, callback);
    } else {
      // upsertStatement is only unset before init() has finished detecting the upsert
      // method. Fail fast: the CacheAndBufferLayer promisifies this callback and awaits it,
      // so silently returning here would leave that promise pending forever.
      callback(Error("PostgreSQL driver not initialised: call init() before set()"), null as any);
    }
  }

  remove(key: string, callback: () => {}) {
    this.db.query(
      { name: "ueberdb_remove", text: "DELETE FROM store WHERE key=$1", values: [key] },
      callback,
    );
  }

  doBulk(bulk: BulkObject[], callback: (err?: Error | null) => void) {
    if (!this.upsertStatement) {
      // See set(): never return without settling the callback, or the promisified
      // wrapper in CacheAndBufferLayer hangs.
      callback(Error("PostgreSQL driver not initialised: call init() before doBulk()"));
      return;
    }

    const setOps: Array<[string, string]> = [];
    const removeKeys: string[] = [];

    for (const op of bulk) {
      if (op.type === "set") setOps.push([op.key, op.value!]);
      else if (op.type === "remove") removeKeys.push(op.key);
    }

    const isNativeUpsert = this.upsertStatement.startsWith("INSERT INTO store(key, value) VALUES");
    // async.parallel expects (err?: Error | null) on its callbacks; pg.query callbacks supply
    // (err: Error). Wrap each query so the error type assigns cleanly without an `any` cast.
    type AsyncTaskCb = (err?: Error | null) => void;
    const tasks: Array<(cb: AsyncTaskCb) => void> = [];

    if (setOps.length > 0) {
      if (isNativeUpsert && setOps.length > 1) {
        // Build a single multi-row VALUES list with positional params.
        const valuesSql: string[] = [];
        const params: string[] = [];
        let i = 1;
        for (const [k, v] of setOps) {
          valuesSql.push(`($${i++},$${i++})`);
          params.push(k, v);
        }
        const sql =
          `INSERT INTO store(key, value) VALUES ${valuesSql.join(",")} ` +
          `ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
        tasks.push((cb) => {
          this.db.query(sql, params, (err) => cb(err));
        });
      } else {
        // Fallback: per-row via the existing upsertStatement (function-based, or single-row native).
        for (const [k, v] of setOps) {
          tasks.push((cb) => {
            this.db.query(this.upsertStatement as string, [k, v], (err) => cb(err));
          });
        }
      }
    }

    if (removeKeys.length > 0) {
      const placeholders = removeKeys.map((_, idx) => `$${idx + 1}`).join(",");
      const sql = `DELETE FROM store WHERE key IN (${placeholders})`;
      tasks.push((cb) => {
        this.db.query(sql, removeKeys, (err) => cb(err));
      });
    }

    async.parallel(tasks, callback);
  }

  close(callback: () => {}) {
    this.db.end(callback);
  }
}
