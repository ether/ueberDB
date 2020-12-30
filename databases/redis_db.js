'use strict';
/* eslint new-cap: ["error", {"capIsNewExceptions": ["KEYS", "SMEMBERS"]}] */

/**
 * 2011 Peter 'Pita' Martischka
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

const AbstractDatabase = require('../lib/AbstractDatabase');
const async = require('async');
const redis = require('redis');

exports.Database = class extends AbstractDatabase {
  constructor(settings) {
    super();
    this.client = null;
    this.settings = settings || {};
  }

  auth(callback) {
    if (!this.settings.password) return callback();
    this.client.auth(this.settings.password, callback);
  }

  select(callback) {
    if (!this.settings.database) return callback();
    this.client.select(this.settings.database, callback);
  }

  _deprecatedInit(callback) {
    if (this.settings.socket) {
      // Deprecated, but kept for backwards compatibility.
      this.client = redis.createClient(this.settings.socket,
          this.settings.client_options);
    } else {
      // Deprecated, but kept for backwards compatibility.
      this.client = redis.createClient(this.settings.port,
          this.settings.host, this.settings.client_options);
    }

    this.client.database = this.settings.database;
    async.waterfall([this.auth.bind(this), this.select.bind(this)], callback);
  }

  init(callback) {
    if (this.settings.socket || this.settings.client_options) return this._deprecatedInit(callback);
    this.client = redis.createClient(this.settings);
    callback();
  }

  get(key, callback) {
    this.client.get(key, callback);
  }

  findKeys(key, notKey, callback) {
    // As redis provides only limited support for getting a list of all
    // available keys we have to limit key and notKey here.
    // See http://redis.io/commands/keys
    if (notKey == null) {
      this.client.KEYS(key, callback);
    } else if (notKey === '*:*:*') {
      // restrict key to format "text:*"
      const matches = /^([^:]+):\*$/.exec(key);
      if (matches) {
        this.client.SMEMBERS(`ueberDB:keys:${matches[1]}`, callback);
      } else {
        const msg = 'redis db only supports key patterns like pad:* when notKey is set to *:*:*';
        callback(new Error(msg), null);
      }
    } else {
      callback(new Error('redis db currently only supports *:*:* as notKey'), null);
    }
  }

  set(key, value, callback) {
    const matches = /^([^:]+):([^:]+)$/.exec(key);
    if (matches) {
      this.client.sadd([`ueberDB:keys:${matches[1]}`, matches[0]]);
    }
    this.client.set(key, value, callback);
  }

  remove(key, callback) {
    const matches = /^([^:]+):([^:]+)$/.exec(key);
    if (matches) {
      this.client.srem([`ueberDB:keys:${matches[1]}`, matches[0]]);
    }
    this.client.del(key, callback);
  }

  doBulk(bulk, callback) {
    const multi = this.client.multi();

    for (const {key, type, value} of bulk) {
      const matches = /^([^:]+):([^:]+)$/.exec(key);
      if (type === 'set') {
        if (matches) {
          multi.sadd([`ueberDB:keys:${matches[1]}`, matches[0]]);
        }
        multi.set(key, value);
      } else if (type === 'remove') {
        if (matches) {
          multi.srem([`ueberDB:keys:${matches[1]}`, matches[0]]);
        }
        multi.del(key);
      }
    }

    multi.exec(callback);
  }

  close(callback) {
    this.client.quit(() => {
      callback();
    });
  }
};
