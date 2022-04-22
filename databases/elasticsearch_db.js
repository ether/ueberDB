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
const es = require('elasticsearch');

exports.Database = class extends AbstractDatabase {
  constructor(settings) {
    super();
    this._client = null;
    this.settings = {
      host: '127.0.0.1',
      port: '9200',
      base_index: 'ueberes',
      // for a list of valid API values see:
      // https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/configuration.html#config-options
      api: '7.6',
      ...settings || {},
    };
  }

  get isAsync() { return true; }

  /**
   * Initialize the elasticsearch client, then ping the server to ensure that a
   * connection was made.
   */
  async init() {
    // create elasticsearch client
    const client = new es.Client({
      host: `${this.settings.host}:${this.settings.port}`,
      apiVersion: this.settings.api,
      // log: "trace" // useful for debugging
    });
    await client.ping({requestTimeout: 3000});
    this._client = client;
  }

  /**
   *  This function provides read functionality to the database.
   *
   *  @param {String} key Key, of the format "test:test1" or, optionally, of the
   *    format "test:test1:check:check1"
   */
  async get(key) {
    let response, error;
    try {
      response = await this._client.get(this._getIndexTypeId(key));
    } catch (err) {
      error = err;
    }
    return parseResponse(error, response);
  }

  /**
   *  The three key scenarios for this are:
   *      (test:test1, null) ; (test:*, *:*:*) ; (test:*, null)
   *
   *  TODO This currently works only for the second implementation above.
   *
   *  For more information:
   *    - See the #Limitations section of the ueberDB README.
   *    - See https://github.com/Pita/ueberDB/wiki/findKeys-functionality, as well
   *      as the sqlite and mysql implementations.
   *
   *  @param key Search key, which uses an asterisk (*) as the wild card.
   *  @param notKey Used to filter the result set
   */
  async findKeys(key, notKey) {
    const splitKey = key.split(':');
    const response = await this._client.search({
      index: this.settings.base_index,
      type: splitKey[0],
      size: 100, // this is a pretty random threshold...
    });
    if (response.hits) {
      const keys = [];
      for (let counter = 0; counter < response.hits.total; counter++) {
        keys.push(`${splitKey[0]}:${response.hits.hits[counter]._id}`);
      }
      return keys;
    }
  }

  /**
   *  This function provides write functionality to the database.
   *
   *  @param {String} key Key, of the format "test:test1" or, optionally, of the
   *    format "test:test1:check:check1"
   *  @param {JSON|String} value The value to be stored to the database.  The value is
   *    always converted to {val:value} before being written to the database, to account
   *    for situations where the value is just a string.
   */
  async set(key, value) {
    const options = this._getIndexTypeId(key);
    options.body = {
      val: value,
    };
    let response, error;
    try {
      response = await this._client.index(options);
    } catch (err) {
      error = err;
    }
    return parseResponse(error, response);
  }

  /**
   *  This function provides delete functionality to the database.
   *
   *  The index, type, and ID will be parsed from the key, and this document will
   *  be deleted from the database.
   *
   *  @param {String} key Key, of the format "test:test1" or, optionally, of the
   *    format "test:test1:check:check1"
   */
  async remove(key) {
    let response, error;
    try {
      response = await this._client.delete(key);
    } catch (err) {
      error = err;
    }
    return parseResponse(error, response);
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

    for (let counter = 0; counter < bulk.length; counter++) {
      const indexTypeId = this._getIndexTypeId(bulk[counter].key);
      const operationPayload = {
        _index: indexTypeId.index,
        _type: indexTypeId.type,
        _id: indexTypeId.id,
      };

      switch (bulk[counter].type) {
        case 'set':
          operations.push({index: operationPayload});
          operations.push({val: JSON.parse(bulk[counter].value)});
          break;
        case 'remove':
          operations.push({delete: operationPayload});
          break;
        default:
          continue;
      }
    }

    let response, error;
    try {
      response = await this._client.bulk({
        body: operations,
      });
    } catch (err) {
      error = err;
    }
    return parseResponse(error, response);
  }

  async close() {}

  /**
   *  This function parses a given key into an object with three
   *  fields, .index, .type, and .id.  This object can then be
   *  used to build an elasticsearch path or to access an object
   *  for bulk updates.
   *
   *  @param {String} key Key, of the format "test:test1" or, optionally, of the
   *    format "test:test1:check:check1"
   */
  _getIndexTypeId(key) {
    const returnObject = {};

    const splitKey = key.split(':');

    if (splitKey.length === 4) {
      /*
       * This is for keys like test:test1:check:check1.
       * These keys are stored at /base_index-test-check/test1/check1
       */
      returnObject.index = `${this.settings.base_index}-${splitKey[0]}-${splitKey[2]}`;
      returnObject.type = encodeURIComponent(splitKey[1]);
      returnObject.id = splitKey[3];
    } else {
      // everything else ('test:test1') is stored /base_index/test/test1
      returnObject.index = this.settings.base_index;
      returnObject.type = splitKey[0];
      returnObject.id = encodeURIComponent(splitKey[1]);
    }

    return returnObject;
  }
};

/**
 * Extract data from elasticsearch responses, handle errors.
 */
const parseResponse = (error, response) => {
  if (error) {
    // don't treat not found as an error (is this specific to etherpad?)
    if (error.message === 'Not Found' && !response.found) return null;
    throw error;
  }

  if (response) {
    response = response._source;

    if (response) {
      response = response.val;
    }

    response = JSON.stringify(response);
  }

  return response;
};
