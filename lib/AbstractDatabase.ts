import {normalizeLogger} from './logging';

const nullLogger = normalizeLogger(null);

// Format: All characters match themselves except * matches any zero or more characters. No
// backslash escaping is supported, so it is impossible to create a pattern that matches only the
// '*' character.
const simpleGlobToRegExp = (s:string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');

export type Settings = {
  data?: Map<string,string>;
  table?: string;
  db?: string;
  idleTimeoutMillis?: any;
  min?: any;
  max?: any;
  engine?: string;
  charset?: string;
  server?: string | undefined;
  requestTimeout?: number;
  bulkLimit?: number;
  queryTimeout?: number;
  connectionString?: string;
  parseJSON?: boolean;
  dbName?: string;
  collection?: string;
  url?: string;
  mock?: any;
  base_index?: string;
  migrate_to_newer_schema?: boolean;
  api?: string
  filename?: string;
  database?: string;
  password?: string;
  user?: string;
  port?: number | string;
  host?: string;
  maxListeners?: number | undefined;
  json?: boolean;
  cache?: number;
  writeInterval?: number;
  logger?: any;
  columnFamily?: any;
  clientOptions?: any;
};


class AbstractDatabase {
  public logger: any;
    public settings: Settings;
  constructor(settings: Settings) {
    if (new.target === module.exports) {
      throw new TypeError('cannot instantiate Abstract Database directly');
    }
    for (const fn of ['init', 'close', 'get', 'findKeys', 'remove', 'set']) {
      // @ts-ignore
      if (typeof this[fn] !== 'function') throw new TypeError(`method ${fn} not defined`);
    }
    this.logger = nullLogger;
    this.settings = settings
  }

  /**
   * For findKey regex. Used by document dbs like mongodb or dirty.
   */
  createFindRegex(key:string, notKey?:string) {
    let regex = `^(?=${simpleGlobToRegExp(key)}$)`;
    if (notKey != null) regex += `(?!${simpleGlobToRegExp(notKey)}$)`;
    return new RegExp(regex);
  }

  doBulk(operations:any, cb: ()=>{}) {
    throw new Error('the doBulk method must be implemented if write caching is enabled');
  }

  get isAsync() { return false; }
}

export default AbstractDatabase;
