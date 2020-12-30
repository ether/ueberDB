'use strict';

module.exports = class AbstractDatabase {
  constructor() {
    if (new.target === module.exports) {
      throw new TypeError('cannot instantiate Abstract Database directly');
    }
    for (const fn of ['init', 'close', 'get', 'findKeys', 'remove', 'set']) {
      if (typeof this[fn] !== 'function') throw new TypeError(`method ${fn} not defined`);
    }
  }

  doBulk(operations, cb) {
    throw new Error('the doBulk method must be implemented if write caching is enabled');
  }

  get isAsync() { return false; }
};
