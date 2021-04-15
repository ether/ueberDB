'use strict';

const events = require('events');

exports.Database = class extends events.EventEmitter {
  constructor(settings) {
    super();
    this.settings = {
      writeInterval: 1,
      ...settings,
    };
    settings.mock = this;
  }

  close(cb) {
    this.emit('close', cb);
  }

  doBulk(ops, cb) {
    this.emit('doBulk', ops, cb);
  }

  findKeys(key, notKey, cb) {
    this.emit('findKeys', key, notKey, cb);
  }

  get(key, cb) {
    this.emit('get', key, cb);
  }

  init(cb) {
    this.emit('init', cb);
  }

  remove(key, cb) {
    this.emit('remove', key, cb);
  }

  set(key, value, cb) {
    this.emit('set', key, value, cb);
  }
};
