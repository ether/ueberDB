'use strict';

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
const redis = require('redis');

exports.Database = class extends AbstractDatabase {
  constructor(settings) {
    super();
    this._client = null;
    this.settings = settings || {};
  }

  get isAsync() { return true; }

  async init() {
    this._client = redis.createClient(this.settings);
    await this._client.connect();
    await this._client.ping();
  }

  async get(key) {
    return await this._client.get(key);
  }

  async findKeys(key, notKey) {
    const [type] = /^([^:*]+):\*$/.exec(key) || [];
    if (type != null && ['*:*:*', `${key}:*`].includes(notKey)) {
      // Performance optimization for a common Etherpad case.
      return await this._client.sMembers(`ueberDB:keys:${type}`);
    }
    let keys = await this._client.keys(key.replace(/[?[\]\\]/g, '\\$&'));
    if (notKey != null) {
      const regex = this.createFindRegex(key, notKey);
      keys = keys.filter((k) => regex.test(k));
    }
    return keys;
  }

  async set(key, value) {
    const matches = /^([^:]+):([^:]+)$/.exec(key);
    await Promise.all([
      matches && this._client.sAdd(`ueberDB:keys:${matches[1]}`, matches[0]),
      this._client.set(key, value),
    ]);
  }

  async remove(key) {
    const matches = /^([^:]+):([^:]+)$/.exec(key);
    await Promise.all([
      matches && this._client.sRem(`ueberDB:keys:${matches[1]}`, matches[0]),
      this._client.del(key),
    ]);
  }

  async doBulk(bulk) {
    const multi = this._client.multi();

    for (const {key, type, value} of bulk) {
      const matches = /^([^:]+):([^:]+)$/.exec(key);
      if (type === 'set') {
        if (matches) {
          multi.sAdd(`ueberDB:keys:${matches[1]}`, matches[0]);
        }
        multi.set(key, value);
      } else if (type === 'remove') {
        if (matches) {
          multi.sRem(`ueberDB:keys:${matches[1]}`, matches[0]);
        }
        multi.del(key);
      }
    }

    await multi.exec();
  }

  async close() {
    await this._client.quit();
    this._client = null;
  }
};
