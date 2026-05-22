/**
 * Cloudflare D1 database driver for ueberDB.
 *
 * D1 is Cloudflare's SQL database built on SQLite. This driver expects a
 * D1Database binding to be passed via `settings.d1Database`. In a Cloudflare
 * Worker you obtain the binding from the worker's `env` object:
 *
 *   const db = new Database('cloudflare_d1', {d1Database: env.MY_D1_BINDING});
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

import AbstractDatabase, {type Settings} from '../lib/AbstractDatabase';
import type {BulkObject} from './cassandra_db';

/**
 * Minimal subset of the Cloudflare D1 API used by this driver.
 * This intentionally mirrors the official @cloudflare/workers-types
 * definitions so that users get type-safety when passing real bindings,
 * while keeping this package free of a hard dependency on that package.
 */
export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(options?: {columnNames?: boolean}): Promise<T[]>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{count: number; duration: number}>;
}

export type D1Settings = Settings & {
  /** The D1Database binding provided by the Cloudflare Worker runtime. */
  d1Database?: D1Database;
};

export default class CloudflareD1DB extends AbstractDatabase {
  private _d1db: D1Database | null;

  constructor(settings: D1Settings) {
    super(settings);
    this._d1db = settings.d1Database ?? null;
    this.settings.json = true;
    this.settings.cache = 1000;
    this.settings.writeInterval = 100;
  }

  get isAsync() {
    return true;
  }

  async init(): Promise<void> {
    if (!this._d1db) {
      throw new Error(
        'CloudflareD1DB requires a D1Database binding passed via settings.d1Database',
      );
    }
    await this._d1db.exec(
      'CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)',
    );
  }

  async get(key: string): Promise<string | null> {
    const row = await this._d1db!
      .prepare('SELECT value FROM store WHERE key = ?')
      .bind(key)
      .first<{value: string}>();
    return row ? row.value : null;
  }

  async findKeys(key: string, notKey?: string | null): Promise<string[]> {
    const likeKey = key.replace(/\*/g, '%');
    let stmt: D1PreparedStatement;
    if (notKey != null) {
      const likeNotKey = notKey.replace(/\*/g, '%');
      stmt = this._d1db!
        .prepare('SELECT key FROM store WHERE key LIKE ? AND key NOT LIKE ?')
        .bind(likeKey, likeNotKey);
    } else {
      stmt = this._d1db!.prepare('SELECT key FROM store WHERE key LIKE ?').bind(likeKey);
    }
    const result = await stmt.all<{key: string}>();
    return result.results.map((row) => row.key);
  }

  async set(key: string, value: string): Promise<void> {
    if (key.length > 100) throw new Error('Your Key can only be 100 chars');
    await this._d1db!
      .prepare('INSERT OR REPLACE INTO store (key, value) VALUES (?, ?)')
      .bind(key, value)
      .run();
  }

  async remove(key: string): Promise<void> {
    await this._d1db!.prepare('DELETE FROM store WHERE key = ?').bind(key).run();
  }

  async doBulk(bulk: BulkObject[]): Promise<void> {
    if (bulk.length === 0) return;
    const statements: D1PreparedStatement[] = [];
    for (const op of bulk) {
      if (op.type === 'set') {
        statements.push(
          this._d1db!
            .prepare('INSERT OR REPLACE INTO store (key, value) VALUES (?, ?)')
            .bind(op.key, op.value),
        );
      } else if (op.type === 'remove') {
        statements.push(
          this._d1db!.prepare('DELETE FROM store WHERE key = ?').bind(op.key),
        );
      }
    }
    await this._d1db!.batch(statements);
  }

  close(): void {
    this._d1db = null;
  }
}
