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

import AbstractDatabase, { type Settings } from "../lib/AbstractDatabase";
import async from "async";
import mssql from "mssql";
import type { ConnectionPool } from "mssql";
import type { BulkObject } from "./cassandra_db";

// Number of ops per generated statement. Each set op binds two parameters, so 100 ops stays far
// below SQL Server's limit of 2100 parameters per request.
export const MSSQL_BULK_CHUNK_SIZE = 100;

// Must match the [key] column width in init().
const MAX_KEY_LENGTH = 100;

export type BulkParamKind = "key" | "value" | "removeKey";

export type BulkStatement = {
  sql: string;
  params: Array<{ name: string; kind: BulkParamKind; value: string }>;
};

const bulkParamType = (kind: BulkParamKind) => {
  switch (kind) {
    case "key":
      return mssql.NVarChar(MAX_KEY_LENGTH);
    case "value":
      return mssql.NText;
    case "removeKey":
      // NVARCHAR(MAX) so that an over-long key is compared in full instead of being silently
      // truncated to 100 characters (which could match, and delete, a different row).
      return mssql.NVarChar(mssql.MAX);
  }
};

/**
 * Turns a bulk op list into parameterised T-SQL statements. Keys and values are only ever bound
 * as parameters (@k<n>, @v<n>, @r<n>) and never appear in the SQL text.
 */
export const buildBulkStatements = (
  bulk: BulkObject[],
  chunkSize: number = MSSQL_BULK_CHUNK_SIZE,
): BulkStatement[] => {
  const sets: BulkObject[] = [];
  const removes: string[] = [];
  for (const op of bulk) {
    if (typeof op.key !== "string") throw new TypeError("bulk op key must be a string");
    if (op.type === "set") {
      if (op.key.length > MAX_KEY_LENGTH) {
        throw new Error(`Your Key can only be ${MAX_KEY_LENGTH} chars`);
      }
      sets.push(op);
    } else if (op.type === "remove") {
      removes.push(op.key);
    } else {
      throw new Error(`unknown op type: ${String(op.type)}`);
    }
  }

  const statements: BulkStatement[] = [];
  for (let start = 0; start < sets.length; start += chunkSize) {
    const params: BulkStatement["params"] = [];
    const lines = ["SET XACT_ABORT ON;", "BEGIN TRANSACTION;"];
    sets.slice(start, start + chunkSize).forEach((op, n) => {
      params.push({ name: `k${n}`, kind: "key", value: op.key });
      params.push({ name: `v${n}`, kind: "value", value: op.value as string });
      lines.push(
        `MERGE [store] t USING (SELECT @k${n} [key], @v${n} [value]) s`,
        "ON t.[key] = s.[key]",
        "WHEN MATCHED AND s.[value] IS NOT NULL THEN UPDATE SET t.[value] = s.[value]",
        "WHEN NOT MATCHED THEN INSERT ([key], [value]) VALUES (s.[key], s.[value]);",
      );
    });
    lines.push("COMMIT TRANSACTION;");
    statements.push({ sql: lines.join("\n"), params });
  }
  for (let start = 0; start < removes.length; start += chunkSize) {
    const chunk = removes.slice(start, start + chunkSize);
    const params = chunk.map((key, n) => ({
      name: `r${n}`,
      kind: "removeKey" as const,
      value: key,
    }));
    const placeholders = params.map((p) => `@${p.name}`).join(",");
    statements.push({ sql: `DELETE FROM [store] WHERE [key] IN (${placeholders});`, params });
  }
  return statements;
};

type RowResult = {
  key: string;
};

export default class MSSQL extends AbstractDatabase {
  public db: ConnectionPool | undefined;
  constructor(settings: Settings) {
    super(settings);
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

  init(callback: (err: any) => {}) {
    const sqlCreate =
      "IF OBJECT_ID(N'dbo.store', N'U') IS NULL" +
      "  BEGIN" +
      "    CREATE TABLE [store] (" +
      "      [key] NVARCHAR(100) PRIMARY KEY," +
      "      [value] NTEXT NOT NULL" +
      "    );" +
      "  END";

    // @ts-ignore
    new mssql.ConnectionPool(this.settings).connect().then((pool) => {
      this.db = pool;

      const request = new mssql.Request(this.db);

      request.query(sqlCreate, (err) => {
        callback(err);
      });

      this.db.on("error", (err) => {
        console.log(err);
      });
    });
  }

  get(key: string, callback: (err?: Error, value?: string) => {}) {
    const request = new mssql.Request(this.db);

    request.input("key", mssql.NVarChar(100), key);

    request.query("SELECT [value] FROM [store] WHERE [key] = @key", (err, results) => {
      let value = null;

      if (!err && results && results.rowsAffected[0] === 1) {
        // @ts-ignore
        value = results.recordset[0].value;
      }

      callback(err, value);
    });
  }

  findKeys(key: string, notKey: string, callback: (err: Error | undefined, value: string[]) => {}) {
    const request = new mssql.Request(this.db);
    let query = "SELECT [key] FROM [store] WHERE [key] LIKE @key";

    // desired keys are key, e.g. pad:%
    key = key.replace(/\*/g, "%");

    request.input("key", mssql.NVarChar(100), key);

    if (notKey != null) {
      // not desired keys are notKey, e.g. %:%:%
      notKey = notKey.replace(/\*/g, "%");
      request.input("notkey", mssql.NVarChar(100), notKey);
      query += " AND [key] NOT LIKE @notkey";
    }

    request.query(query, (err, results) => {
      const value: string[] = [];

      if (!err && results && results.rowsAffected[0] > 0) {
        for (let i = 0; i < results.recordset.length; i++) {
          value.push((results.recordset[i] as RowResult).key);
        }
      }

      callback(err, value);
    });
  }

  set(key: string, value: string, callback: (val: string) => {}) {
    const request = new mssql.Request(this.db);

    if (key.length > 100) {
      callback("Your Key can only be 100 chars");
    } else {
      const query =
        "MERGE [store] t USING (SELECT @key [key], @value [value]) s" +
        " ON t.[key] = s.[key]" +
        " WHEN MATCHED AND s.[value] IS NOT NULL THEN UPDATE SET t.[value] = s.[value]" +
        " WHEN NOT MATCHED THEN INSERT ([key], [value]) VALUES (s.[key], s.[value]);";

      request.input("key", mssql.NVarChar(100), key);
      request.input("value", mssql.NText, value);

      request.query(query, (err, info) => {
        callback(err ? err.toString() : "");
      });
    }
  }

  remove(key: string, callback: () => {}) {
    const request = new mssql.Request(this.db);
    request.input("key", mssql.NVarChar(100), key);
    request.query("DELETE FROM [store] WHERE [key] = @key", callback);
  }

  doBulk(bulk: BulkObject[], callback: (err: any, results?: any) => {}) {
    let statements: BulkStatement[];
    try {
      statements = buildBulkStatements(bulk);
    } catch (err) {
      // CacheAndBufferLayer falls back to per-op set()/remove() on a doBulk error, which
      // reports the problem (e.g. an over-long key) for the affected op only.
      callback(err);
      return;
    }

    async.mapSeries(
      statements,
      (statement: BulkStatement, cb: (err?: Error | null, result?: unknown) => void) => {
        const request = new mssql.Request(this.db);
        for (const param of statement.params) {
          request.input(param.name, bulkParamType(param.kind), param.value);
        }
        request.query(statement.sql, (err, result) => cb(err, result));
      },
      (err, results) => callback(err, results),
    );
  }

  close(callback: (err?: Error) => {}) {
    this.db && this.db.close(callback);
  }
}
