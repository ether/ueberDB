/**
 * 2011 Peter 'Pita' Martischka
 * 2020 John McLear
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

import {Database as DatabaseCache, type Metrics} from './lib/CacheAndBufferLayer';
import {normalizeLogger} from './lib/logging';
import type {Settings} from './lib/AbstractDatabase';

export type {Settings} from './lib/AbstractDatabase';
export type {Metrics, CacheSettings} from './lib/CacheAndBufferLayer';
export type {Logger} from './lib/logging';

// Database drivers are loaded lazily in initDB() so that only the selected
// backend's dependencies need to be installed.

export type DatabaseType =
  | 'cassandra'
  | 'couch'
  | 'dirty'
  | 'dirtygit'
  | 'elasticsearch'
  | 'memory'
  | 'mock'
  | 'mongodb'
  | 'mssql'
  | 'mysql'
  | 'postgres'
  | 'postgrespool'
  | 'redis'
  | 'rethink'
  | 'rustydb'
  | 'sqlite'
  | 'surrealdb';

export class Database {
  public readonly type: DatabaseType;
  public readonly dbSettings: Settings | null | string;
  public readonly wrapperSettings: Record<string, unknown> | null;
  private readonly _logger: ReturnType<typeof normalizeLogger>;
  public db!: DatabaseCache;
  public metrics!: Metrics;

  /**
   * @param type The type of the database
   * @param dbSettings The settings for that specific database type
   * @param wrapperSettings Cache/buffer layer settings (cache size, write interval, etc.)
   * @param logger Optional logger (log4js, console, or any object with debug/info/warn/error methods)
   */
  constructor(
    type: DatabaseType | undefined,
    dbSettings: Settings | null | string,
    wrapperSettings?: Record<string, unknown> | null,
    logger: Partial<ReturnType<typeof normalizeLogger>> | null = null,
  ) {
    if (!type) {
      type = 'sqlite';
      dbSettings = null;
      wrapperSettings = null;
    }
    this.type = type;
    this.dbSettings = dbSettings;
    this.wrapperSettings = wrapperSettings ?? null;
    this._logger = normalizeLogger(logger);
  }

  async init(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = await this.initDB();
    db.logger = this._logger;
    this.db = new DatabaseCache(db, this.wrapperSettings, this._logger);
    this.metrics = this.db.metrics;
    await this.db.init();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async initDB(): Promise<any> {
    switch (this.type) {
      case 'mysql':
        return new (await import('./databases/mysql_db')).default(this.dbSettings as Settings);
      case 'postgres':
        return new (await import('./databases/postgres_db')).default(this.dbSettings as Settings);
      case 'sqlite':
        return new (await import('./databases/sqlite_db')).default(this.dbSettings as Settings);
      case 'rustydb':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return new (await import('./databases/rusty_db')).default(this.dbSettings as any);
      case 'mongodb':
        return new (await import('./databases/mongodb_db')).default(this.dbSettings as Settings);
      case 'redis':
        return new (await import('./databases/redis_db')).default(this.dbSettings as Settings);
      case 'cassandra':
        return new (await import('./databases/cassandra_db')).default(this.dbSettings as Settings);
      case 'dirty':
        return new (await import('./databases/dirty_db')).default(this.dbSettings as Settings);
      case 'dirtygit':
        return new (await import('./databases/dirty_git_db')).default(this.dbSettings as Settings);
      case 'elasticsearch':
        return new (await import('./databases/elasticsearch_db')).default(
          this.dbSettings as Settings,
        );
      case 'memory':
        return new (await import('./databases/memory_db')).default(this.dbSettings as Settings);
      case 'mock':
        return new (await import('./databases/mock_db')).default(this.dbSettings as Settings);
      case 'mssql':
        return new (await import('./databases/mssql_db')).default(this.dbSettings as Settings);
      case 'postgrespool':
        return new (await import('./databases/postgrespool_db')).default(
          this.dbSettings as Settings,
        );
      case 'rethink':
        return new (await import('./databases/rethink_db')).default(this.dbSettings as Settings);
      case 'couch':
        return new (await import('./databases/couch_db')).default(this.dbSettings as Settings);
      case 'surrealdb':
        return new (await import('./databases/surrealdb_db')).default(this.dbSettings as Settings);
      default:
        throw new Error(`Invalid database type: ${this.type as string}`);
    }
  }

  async flush(): Promise<void> {
    return this.db.flush();
  }

  /** @deprecated Use flush() */
  doShutdown(): Promise<void> {
    return this.flush();
  }

  async get(key: string): Promise<unknown> {
    return this.db.get(key);
  }

  async findKeys(key: string, notKey?: string): Promise<string[]> {
    return this.db.findKeys(key, notKey);
  }

  async remove(key: string): Promise<void> {
    return this.db.remove(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    return this.db.set(key, value);
  }

  async getSub(key: string, sub: string[]): Promise<unknown> {
    return this.db.getSub(key, sub);
  }

  async setSub(key: string, sub: string[], value: unknown): Promise<void> {
    return this.db.setSub(key, sub, value);
  }

  async close(): Promise<void> {
    return this.db.close();
  }
}

export default Database;
