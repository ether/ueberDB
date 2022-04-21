'use strict';
/**
 * 2012 Max 'Azul' Wiehle
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
const http = require('http');
const nano = require('nano');

exports.Database = class extends AbstractDatabase {
  constructor(settings) {
    super();
    this.agent = null;
    this.db = null;
    this.settings = settings;

    // force some settings
    // used by CacheAndBufferLayer.js
    this.settings.cache = 1000;
    this.settings.writeInterval = 100;
    this.settings.json = false;
  }

  get isAsync() { return true; }

  async init() {
    this.agent = new http.Agent({
      keepAlive: true,
      maxSockets: this.settings.maxListeners || 1,
    });
    const client = nano({
      url: `http://${this.settings.host}:${this.settings.port}`,
      requestDefaults: {
        auth: {
          username: this.settings.user,
          password: this.settings.password,
        },
        httpAgent: this.agent,
      },
    });
    try {
      await client.db.get(this.settings.database);
    } catch (err) {
      if (err.statusCode !== 404) throw err;
      await client.db.create(this.settings.database);
    }
    this.db = client.use(this.settings.database);
  }

  async get(key) {
    let doc;
    try {
      doc = await this.db.get(key);
    } catch (err) {
      if (err.statusCode === 404) return null;
      throw err;
    }
    return doc.value;
  }

  async findKeys(key, notKey) {
    const pfxLen = key.indexOf('*');
    const pfx = pfxLen < 0 ? key : key.slice(0, pfxLen);
    const results = await this.db.find({
      selector: {
        _id: pfxLen < 0 ? pfx : {
          $gte: pfx,
          // https://docs.couchdb.org/en/3.2.2/ddocs/views/collation.html#string-ranges
          $lte: `${pfx}\ufff0`,
          $regex: this.createFindRegex(key, notKey).source,
        },
      },
      fields: ['_id'],
    });
    return results.docs.map((doc) => doc._id);
  }

  async set(key, value) {
    let doc;
    try {
      doc = await this.db.get(key);
    } catch (err) {
      if (err.statusCode !== 404) throw err;
    }
    await this.db.insert({
      _id: key,
      value,
      ...doc == null ? {} : {
        _rev: doc._rev,
      },
    });
  }

  async remove(key) {
    let header;
    try {
      header = await this.db.head(key);
    } catch (err) {
      if (err.statusCode === 404) return;
      throw err;
    }
    // etag has additional quotation marks, remove them
    const etag = JSON.parse(header.etag);
    await this.db.destroy(key, etag);
  }

  async doBulk(bulk) {
    const keys = bulk.map((op) => op.key);
    const revs = {};
    for (const {key, value} of (await this.db.fetchRevs({keys})).rows) {
      // couchDB will return error instead of value if key does not exist
      if (value != null) revs[key] = value.rev;
    }
    const setters = [];
    for (const item of bulk) {
      const set = {_id: item.key};
      if (revs[item.key] != null) set._rev = revs[item.key];
      if (item.type === 'set') set.value = item.value;
      if (item.type === 'remove') set._deleted = true;
      setters.push(set);
    }
    await this.db.bulk({docs: setters});
  }

  async close() {
    this.db = null;
    if (this.agent) this.agent.destroy();
    this.agent = null;
  }
};
