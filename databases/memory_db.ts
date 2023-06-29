'use strict';

import {Settings} from "../lib/AbstractDatabase";

const AbstractDatabase = require('../lib/AbstractDatabase');

exports.Database = class extends AbstractDatabase {
  constructor(settings:Settings) {
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

  findKeys(key:string, notKey:string) {
    const regex = this.createFindRegex(key, notKey);
    return [...this._data.keys()].filter((k) => regex.test(k));
  }

  get(key:string) {
    return this._data.get(key);
  }

  init() {
    this._data = this.settings.data || new Map();
  }

  remove(key:string) {
    this._data.delete(key);
  }

  set(key:string, value:string) {
    this._data.set(key, value);
  }
};
