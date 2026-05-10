import {normalizeLogger, type Logger} from './logging.ts';

const nullLogger = normalizeLogger(null);

const simpleGlobToRegExp = (s: string) =>
  s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');

export type Settings = {
  data?: unknown;
  table?: string;
  db?: string;
  idleTimeoutMillis?: number;
  min?: number;
  max?: number;
  engine?: string;
  charset?: string;
  server?: string;
  requestTimeout?: number;
  bulkLimit?: number;
  queryTimeout?: number;
  connectionString?: string;
  parseJSON?: boolean;
  dbName?: string;
  collection?: string;
  url?: string;
  mock?: unknown;
  base_index?: string;
  migrate_to_newer_schema?: boolean;
  api?: string;
  filename?: string;
  database?: string;
  password?: string;
  user?: string;
  port?: number | string;
  host?: string;
  maxListeners?: number;
  json?: boolean;
  cache?: number;
  writeInterval?: number;
  logger?: Logger;
  columnFamily?: unknown;
  clientOptions?: unknown;
};

class AbstractDatabase {
  public logger: Logger;
  public settings: Settings;

  constructor(settings: Settings) {
    if (new.target === AbstractDatabase) {
      throw new TypeError('cannot instantiate Abstract Database directly');
    }
    for (const fn of ['init', 'close', 'get', 'findKeys', 'remove', 'set']) {
      if (typeof (this as Record<string, unknown>)[fn] !== 'function') {
        throw new TypeError(`method ${fn} not defined`);
      }
    }
    this.logger = nullLogger;
    this.settings = settings;
  }

  createFindRegex(key: string, notKey?: string): RegExp {
    let regex = `^(?=${simpleGlobToRegExp(key)}$)`;
    if (notKey != null) regex += `(?!${simpleGlobToRegExp(notKey)}$)`;
    return new RegExp(regex);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doBulk(..._args: any[]): void | Promise<void> {
    throw new Error('the doBulk method must be implemented if write caching is enabled');
  }

  get isAsync(): boolean { return false; }
}

export default AbstractDatabase;
