'use strict';

const logging = require('./logging');

const nullLogger = logging.normalizeLogger(null);

module.exports = class AbstractDatabase {
  constructor() {
    if (new.target === module.exports) {
      throw new TypeError('cannot instantiate Abstract Database directly');
    }
    for (const fn of ['init', 'close', 'get', 'findKeys', 'remove', 'set']) {
      if (typeof this[fn] !== 'function') throw new TypeError(`method ${fn} not defined`);
    }
    this.logger = nullLogger;
  }

  /**
   * For findKey regex. Used by document dbs like mongodb or dirty.
   */
  createFindRegex(key, notKey) {
    let regex = '';
    key = key.replace(/\*/g, '.*');
    regex = `(?=^${key}$)`;
    if (notKey != null) {
      notKey = notKey.replace(/\*/g, '.*');
      regex += `(?!${notKey}$)`;
    }
    return new RegExp(regex);
  }

  doBulk(operations, cb) {
    throw new Error('the doBulk method must be implemented if write caching is enabled');
  }

  get isAsync() { return false; }
};
