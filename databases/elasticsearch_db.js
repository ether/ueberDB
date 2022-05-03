'use strict';
/**
 * 2015 Visionist, Inc.
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
const assert = require('assert').strict;
const {Buffer} = require('buffer');
const crypto = require('crypto');
const es = require('elasticsearch7');

const schema = '2';

const keyToId = (key) => {
  const keyBuf = Buffer.from(key);
  return keyBuf.length > 512 ? crypto.createHash('sha512').update(keyBuf).digest('hex') : key;
};

const mappings = {
  // _id is expected to equal key, unless the UTF-8 encoded key is > 512 bytes, in which case it is
  // the hex-encoded sha512 hash of the UTF-8 encoded key.
  properties: {
    key: {type: 'wildcard'}, // For findKeys, and because _id is limited to 512 bytes.
    value: {type: 'object', enabled: false}, // Values should be opaque to Elasticsearch.
  },
};

const migrateToSchema2 = async (client, v1BaseIndex, v2Index, logger) => {
  let recordsMigratedLastLogged = 0;
  let recordsMigrated = 0;
  const totals = new Map();
  logger.info('Attempting elasticsearch record migration from schema v1 at base index ' +
              `${v1BaseIndex} to schema v2 at index ${v2Index}...`);
  const {body: indices} = await client.indices.get({index: [v1BaseIndex, `${v1BaseIndex}-*-*`]});
  const scrollIds = new Map();
  const q = [];
  try {
    for (const index of Object.keys(indices)) {
      const {body: res} = await client.search({index, scroll: '10m'});
      scrollIds.set(index, res._scroll_id);
      q.push({index, res});
    }
    while (q.length) {
      const {index, res: {hits: {hits, total: {value: total}}}} = q.shift();
      if (hits.length === 0) continue;
      totals.set(index, total);
      const body = [];
      for (const {_id, _type, _source: {val}} of hits) {
        let key = `${_type}:${_id}`;
        if (index !== v1BaseIndex) {
          const parts = index.slice(v1BaseIndex.length + 1).split('-');
          if (parts.length !== 2) {
            throw new Error(`unable to migrate records from index ${index} due to data ambiguity`);
          }
          key = `${parts[0]}:${decodeURIComponent(_type)}:${parts[1]}:${_id}`;
        }
        body.push({index: {_id: keyToId(key)}}, {key, value: JSON.parse(val)});
      }
      await client.bulk({index: v2Index, body});
      recordsMigrated += hits.length;
      if (Math.floor(recordsMigrated / 100) > Math.floor(recordsMigratedLastLogged / 100)) {
        const total = [...totals.values()].reduce((a, b) => a + b, 0);
        logger.info(`Migrated ${recordsMigrated} records out of ${total}`);
        recordsMigratedLastLogged = recordsMigrated;
      }
      q.push(
          {index, res: (await client.scroll({scroll: '5m', scrollId: scrollIds.get(index)})).body});
    }
    logger.info(`Finished migrating ${recordsMigrated} records`);
  } finally {
    await Promise.all([...scrollIds.values()].map((scrollId) => client.clearScroll({scrollId})));
  }
};

exports.Database = class extends AbstractDatabase {
  constructor(settings) {
    super();
    this._client = null;
    this.settings = {
      host: '127.0.0.1',
      port: '9200',
      base_index: 'ueberes',
      migrate_to_newer_schema: false,
      // for a list of valid API values see:
      // https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/configuration.html#config-options
      api: '7.6',
      ...settings || {},
      json: false, // Elasticsearch will do the JSON conversion as necessary.
    };
    this._index = `${this.settings.base_index}_s${schema}`;
    this._q = {index: this._index};
    this._indexClean = true;
  }

  get isAsync() { return true; }

  async _refreshIndex() {
    if (this._indexClean) return;
    this._indexClean = true;
    await this._client.indices.refresh(this._q);
  }

  /**
   * Initialize the elasticsearch client, then ping the server to ensure that a
   * connection was made.
   */
  async init() {
    // create elasticsearch client
    const client = new es.Client({
      node: `http://${this.settings.host}:${this.settings.port}`,
    });
    await client.ping();
    if (!(await client.indices.exists({index: this._index})).body) {
      let tmpIndex;
      const {body: migrate} = await client.indices.exists({index: this.settings.base_index});
      if (migrate && !this.settings.migrate_to_newer_schema) {
        throw new Error(
            `Data exists under the legacy index (schema) named ${this.settings.base_index}. ` +
            'Set migrate_to_newer_schema to true to copy the existing data to a new index ' +
            `named ${this._index}.`);
      }
      let attempt = 0;
      while (true) {
        tmpIndex = `${this._index}_${migrate ? 'migrate_attempt_' : 'i'}${attempt++}`;
        if (!(await client.indices.exists({index: tmpIndex})).body) break;
      }
      await client.indices.create({index: tmpIndex, body: {mappings}});
      if (migrate) await migrateToSchema2(client, this.settings.base_index, tmpIndex, this.logger);
      await client.indices.putAlias({index: tmpIndex, name: this._index});
    }
    const indices = Object.values((await client.indices.get({index: this._index})).body);
    assert.equal(indices.length, 1);
    try {
      assert.deepEqual(indices[0].mappings, mappings);
    } catch (err) {
      this.logger.warn(`Index ${this._index} mappings does not match expected; ` +
                       `attempting to use index anyway. Details: ${err}`);
    }
    this._client = client;
  }

  /**
   *  This function provides read functionality to the database.
   *
   *  @param {String} key Key
   */
  async get(key) {
    const {body} = await this._client.get({...this._q, id: keyToId(key)}, {ignore: [404]});
    if (!body.found) return null;
    return body._source.value;
  }

  /**
   *  @param key Search key, which uses an asterisk (*) as the wild card.
   *  @param notKey Used to filter the result set
   */
  async findKeys(key, notKey) {
    await this._refreshIndex();
    const q = {
      ...this._q,
      body: {
        query: {
          bool: {
            filter: {wildcard: {key: {value: key}}},
            ...notKey == null ? {} : {
              must_not: {wildcard: {key: {value: notKey}}},
            },
          },
        },
      },
    };
    const {body: {hits: {hits}}} = await this._client.search(q);
    return hits.map((h) => h._source.key);
  }

  /**
   *  This function provides write functionality to the database.
   *
   *  @param {String} key Record identifier.
   *  @param {JSON|String} value The value to store in the database.
   */
  async set(key, value) {
    this._indexClean = false;
    await this._client.index({...this._q, id: keyToId(key), body: {key, value}});
  }

  /**
   *  This function provides delete functionality to the database.
   *
   *  The index, type, and ID will be parsed from the key, and this document will
   *  be deleted from the database.
   *
   *  @param {String} key Record identifier.
   */
  async remove(key) {
    this._indexClean = false;
    await this._client.delete({...this._q, id: keyToId(key)}, {ignore: [404]});
  }

  /**
   *  This uses the bulk upload functionality of elasticsearch (url:port/_bulk).
   *
   *  The CacheAndBufferLayer will periodically (every this.settings.writeInterval)
   *  flush writes that have already been done in the local cache out to the database.
   *
   *  @param {Array} bulk An array of JSON data in the format:
   *      {"type":type, "key":key, "value":value}
   */
  async doBulk(bulk) {
    // bulk is an array of JSON:
    // example: [{"type":"set", "key":"sessionstorage:{id}", "value":{"cookie":{...}}]

    const operations = [];

    for (const {type, key, value} of bulk) {
      this._indexClean = false;
      switch (type) {
        case 'set':
          operations.push({index: {_id: keyToId(key)}});
          operations.push({key, value});
          break;
        case 'remove':
          operations.push({delete: {_id: keyToId(key)}});
          break;
        default:
          continue;
      }
    }
    await this._client.bulk({...this._q, body: operations});
  }

  async close() {
    if (this._client != null) this._client.close();
    this._client = null;
  }
};
