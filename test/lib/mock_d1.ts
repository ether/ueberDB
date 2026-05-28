/**
 * A lightweight mock implementation of the Cloudflare D1 API backed by
 * Node.js's built-in `node:sqlite` module.  Used only in tests.
 *
 * The mock mirrors the interface defined in cloudflare_d1_db.ts so that
 * the driver can be exercised locally without a real Cloudflare runtime.
 */

import {DatabaseSync} from 'node:sqlite';
import type {D1Database, D1PreparedStatement, D1Result} from '../../databases/cloudflare_d1_db';

class MockD1PreparedStatement implements D1PreparedStatement {
  private readonly _db: DatabaseSync;
  private readonly _sql: string;
  private readonly _bindings: unknown[];

  constructor(db: DatabaseSync, sql: string, bindings: unknown[] = []) {
    this._db = db;
    this._sql = sql;
    this._bindings = bindings;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new MockD1PreparedStatement(this._db, this._sql, values);
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const stmt = this._db.prepare(this._sql);
    stmt.run(...(this._bindings as Parameters<typeof stmt.run>));
    return {results: [], success: true, meta: {}};
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const stmt = this._db.prepare(this._sql);
    const row = stmt.get(...(this._bindings as Parameters<typeof stmt.get>)) as
      | Record<string, unknown>
      | undefined;
    if (row == null) return null;
    if (colName != null) return (row[colName] ?? null) as T | null;
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const stmt = this._db.prepare(this._sql);
    const results = stmt.all(...(this._bindings as Parameters<typeof stmt.all>)) as T[];
    return {results, success: true, meta: {}};
  }

  async raw<T = unknown[]>(options?: {columnNames?: boolean}): Promise<T[]> {
    // Simplified: return rows as arrays without column names unless requested
    const result = await this.all<Record<string, unknown>>();
    if (!result.results.length) return [] as unknown as T[];
    const cols = Object.keys(result.results[0]);
    const rows: unknown[][] = result.results.map((r) => cols.map((c) => r[c]));
    if (options?.columnNames) {
      return [cols, ...rows] as unknown as T[];
    }
    return rows as unknown as T[];
  }
}

export class MockD1Database implements D1Database {
  private readonly _db: DatabaseSync;

  constructor() {
    this._db = new DatabaseSync(':memory:');
  }

  prepare(sql: string): D1PreparedStatement {
    return new MockD1PreparedStatement(this._db, sql);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return Promise.all(statements.map((s) => s.run<T>()));
  }

  async exec(sql: string): Promise<{count: number; duration: number}> {
    this._db.exec(sql);
    return {count: 0, duration: 0};
  }
}
