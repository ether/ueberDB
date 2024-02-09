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

import AbstractDatabase, {Settings} from '../lib/AbstractDatabase';
import assert, {equal} from 'assert';

import {Buffer} from 'buffer';
import {createHash} from 'crypto';
import {Client} from 'elasticsearch8';
import {BulkObject} from './cassandra_db';
import {MappingTypeMapping} from "elasticsearch8/lib/api/types";

const schema = '2';

const keyToId = (key:string) => {
  const keyBuf = Buffer.from(key);
  return keyBuf.length > 512 ? createHash('sha512').update(keyBuf).digest('hex') : key;
};

const mappings: MappingTypeMapping = {
  // _id is expected to equal key, unless the UTF-8 encoded key is > 512 bytes, in which case it is
  // the hex-encoded sha512 hash of the UTF-8 encoded key.
  properties: {
    key: {type: 'wildcard'}, // For findKeys, and because _id is limited to 512 bytes.
    value: {type: 'object', enabled: false}, // Values should be opaque to Elasticsearch.
  },
};

const migrateToSchema2 = async (client: Client, v1BaseIndex: string | undefined, v2Index: string, logger: any) => {
  let recordsMigratedLastLogged = 0;
  let recordsMigrated = 0;
  const totals = new Map();
  logger.info('Attempting elasticsearch record migration from schema v1 at base index ' +
              `${v1BaseIndex} to schema v2 at index ${v2Index}...`);
  const indices = await client.indices.get({index: [v1BaseIndex as string, `${v1BaseIndex}-*-*`]});
  const scrollIds = new Map();
  const q = [];
  try {
    for (const index of Object.keys(indices)) {
      const res = await client.search({index, scroll: '10m'});
      scrollIds.set(index, res._scroll_id);
      q.push({index, res});
    }
    while (q.length) {
      const {index, res: {hits: {hits, total: {value: total}}}}:any = q.shift();
      if (hits.length === 0) continue;
      totals.set(index, total);
      const body = [];
      for (const {_id, _type, _source: {val}} of hits) {
        let key = `${_type}:${_id}`;
        if (v1BaseIndex && index !== v1BaseIndex) {
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
          {index, res: (await client.scroll({scroll: '5m', scroll_id: scrollIds.get(index)}))});
    }
    logger.info(`Finished migrating ${recordsMigrated} records`);
  } finally {
    await Promise.all([...scrollIds.values()].map((scrollId) => client.clearScroll({scroll_id:scrollId})));
  }
};

export default class extends AbstractDatabase {
  public _client: any;
  public readonly _index: any;
  public _indexClean: boolean;
  public readonly _q: {index: any};
  constructor(settings:Settings) {
    super(settings);
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
    const client = new Client({
      node: `http://${this.settings.host}:${this.settings.port}`,
    });
    await client.ping();
    if (!(await client.indices.exists({index: this._index}))) {
      let tmpIndex;
      const exists = await client.indices.exists({index: this.settings.base_index as string});
      if (exists && !this.settings.migrate_to_newer_schema) {
        throw new Error(
            `Data exists under the legacy index (schema) named ${this.settings.base_index}. ` +
            'Set migrate_to_newer_schema to true to copy the existing data to a new index ' +
            `named ${this._index}.`);
      }
      let attempt = 0;
      while (true) {
        tmpIndex = `${this._index}_${exists ? 'migrate_attempt_' : 'i'}${attempt++}`;
        if (!(await client.indices.exists({index: tmpIndex}))) break;
      }
      await client.indices.create({index: tmpIndex, mappings: mappings});
      if (exists) await migrateToSchema2(client, this.settings.base_index, tmpIndex, this.logger);
      await client.indices.putAlias({index: tmpIndex, name: this._index});
    }
    const indices = Object.values((await client.indices.get({index: this._index})));
    equal(indices.length, 1);
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
  async get(key:string) {
    const res = await this._client.get({...this._q, id: keyToId(key)}, {ignore: [404]});
    if (!res.found) return null;
    return res._source.value;
  }

  /**
   *  @param key Search key, which uses an asterisk (*) as the wild card.
   *  @param notKey Used to filter the result set
   */
  async findKeys(key:string, notKey:string) {
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
    const {hits:hits} = await this._client.search(q);
    return hits.hits.map((h:{_source:{key:string}}) => h._source.key);
  }

  /**
   *  This function provides write functionality to the database.
   *
   *  @param {String} key Record identifier.
   *  @param {JSON|String} value The value to store in the database.
   */
  async set(key: string, value:string) {
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
  async remove(key:string) {
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
  async doBulk(bulk: BulkObject[]) {
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
      }
    }
    await this._client.bulk({...this._q, body: operations});
  }

  async close() {
    if (this._client != null) this._client.close();
    this._client = null;
  }
};
