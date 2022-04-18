'use strict';

const AbstractDatabase = require('../lib/AbstractDatabase');

exports.Database = class extends AbstractDatabase {
  constructor(settings) {
    super();
    this.settings = settings;
    settings.json = false;
    settings.cache = 0;
    settings.writeInterval = 0;
    this._data = null;
  }

  get isAsync() { return true; }

  close() {
    this._data = null;
  }

  findKeys(key, notKey) {
    const regex = this.createFindRegex(key, notKey);
    return [...this._data.keys()].filter((k) => regex.test(k));
  }

  get(key) {
    return this._data.get(key);
  }

  init() {
    this._data = this.settings.data || new Map();
  }

  remove(key) {
    this._data.delete(key);
  }

  set(key, value) {
    this._data.set(key, value);
  }
};
