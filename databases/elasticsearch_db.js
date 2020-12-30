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

// initialize w/ default settings
const elasticsearchSettings = {
  hostname: '127.0.0.1',
  port: '9200',
  base_index: 'ueberes',

  // for a list of valid API values see:
  // https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/configuration.html#config-options
  api: '7.6',
};

let client;

exports.Database = class extends AbstractDatabase {
  constructor(settings) {
    super();
    this.db = null;

    this.settings = settings || {};

    // update settings if they were provided
    if (this.settings.host) {
      elasticsearchSettings.hostname = this.settings.host;
    }

    if (this.settings.port) {
      elasticsearchSettings.port = this.settings.port;
    }

    if (this.settings.base_index) {
      elasticsearchSettings.base_index = this.settings.base_index;
    }

    if (this.settings.api) {
      elasticsearchSettings.api = this.settings.api;
    }
  }

  /**
   * Initialize the elasticsearch client, then ping the server to ensure that a
   * connection was made.
   */
  init(callback) {
    // create elasticsearch client
    client = new es.Client({
      host: `${elasticsearchSettings.hostname}:${elasticsearchSettings.port}`,
      apiVersion: elasticsearchSettings.api,
      // log: "trace" // useful for debugging
    });

    // test the connection
    client.ping({
      requestTimeout: 3000,
    }, (error) => {
      if (error) {
        console.error('unable to communicate with elasticsearch');
      }

      callback(error);
    });
  }

  /**
   *  This function provides read functionality to the database.
   *
   *  @param {String} key Key, of the format "test:test1" or, optionally, of the
   *    format "test:test1:check:check1"
   *  @param {function} callback Function will be called in the event of an error or
   *    upon completion of a successful database retrieval.
   */
  get(key, callback) {
    client.get(getIndexTypeId(key), (error, response) => {
      parseResponse(error, response, callback);
    });
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
   *  @param callback First param is error, second is result
   */
  findKeys(key, notKey, callback) {
    const splitKey = key.split(':');

    client.search({
      index: elasticsearchSettings.base_index,
      type: splitKey[0],
      size: 100, // this is a pretty random threshold...
    }, (error, response) => {
      if (error) {
        console.error('findkeys', error);
        callback(error);
        return;
      }

      if (!error && response.hits) {
        const keys = [];
        for (let counter = 0; counter < response.hits.total; counter++) {
          keys.push(`${splitKey[0]}:${response.hits.hits[counter]._id}`);
        }
        callback(null, keys);
      }
    });
  }

  /**
   *  This function provides write functionality to the database.
   *
   *  @param {String} key Key, of the format "test:test1" or, optionally, of the
   *    format "test:test1:check:check1"
   *  @param {JSON|String} value The value to be stored to the database.  The value is
   *    always converted to {val:value} before being written to the database, to account
   *    for situations where the value is just a string.
   *  @param {function} callback Function will be called in the event of an error or on
   *    completion of a successful database write.
   */
  set(key, value, callback) {
    const options = getIndexTypeId(key);

    options.body = {
      val: value,
    };

    client.index(options, (error, response) => {
      parseResponse(error, response, callback);
    });
  }

  /**
   *  This function provides delete functionality to the database.
   *
   *  The index, type, and ID will be parsed from the key, and this document will
   *  be deleted from the database.
   *
   *  @param {String} key Key, of the format "test:test1" or, optionally, of the
   *    format "test:test1:check:check1"
   *  @param {function} callback Function will be called in the event of an error or on
   *    completion of a successful database write.
   */
  remove(key, callback) {
    client.delete(key, (error, response) => {
      parseResponse(error, response, callback);
    });
  }

  /**
   *  This uses the bulk upload functionality of elasticsearch (url:port/_bulk).
   *
   *  The CacheAndBufferLayer will periodically (every this.settings.writeInterval)
   *  flush writes that have already been done in the local cache out to the database.
   *
   *  @param {Array} bulk An array of JSON data in the format:
   *      {"type":type, "key":key, "value":value}
   *  @param {function} callback This function will be called on an error or upon the
   *      successful completion of the database write.
   */
  doBulk(bulk, callback) {
    // bulk is an array of JSON:
    // example: [{"type":"set", "key":"sessionstorage:{id}", "value":{"cookie":{...}}]

    const operations = [];

    for (let counter = 0; counter < bulk.length; counter++) {
      const indexTypeId = getIndexTypeId(bulk[counter].key);
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

    // send bulk request
    client.bulk({
      body: operations,
    }, (error, response) => {
      parseResponse(error, response, callback);
    });
  }

  close(callback) {
    callback(null);
  }
};

/** ************************
 **** Helper functions ****
 **************************/

/**
 *  This function parses a given key into an object with three
 *  fields, .index, .type, and .id.  This object can then be
 *  used to build an elasticsearch path or to access an object
 *  for bulk updates.
 *
 *  @param {String} key Key, of the format "test:test1" or, optionally, of the
 *    format "test:test1:check:check1"
 */
const getIndexTypeId = (key) => {
  const returnObject = {};

  const splitKey = key.split(':');

  if (splitKey.length === 4) {
    /*
     * This is for keys like test:test1:check:check1.
     * These keys are stored at /base_index-test-check/test1/check1
     */
    returnObject.index = `${elasticsearchSettings.base_index}-${splitKey[0]}-${splitKey[2]}`;
    returnObject.type = encodeURIComponent(splitKey[1]);
    returnObject.id = splitKey[3];
  } else {
    // everything else ('test:test1') is stored /base_index/test/test1
    returnObject.index = elasticsearchSettings.base_index;
    returnObject.type = splitKey[0];
    returnObject.id = encodeURIComponent(splitKey[1]);
  }

  return returnObject;
};

/**
 * Extract data from elasticsearch responses, handle errors, handle callbacks.
 */
const parseResponse = (error, response, callback) => {
  if (error) {
    // don't treat not found as an error (is this specific to etherpad?)
    if (error.message === 'Not Found' && !response.found) {
      callback(null, null);
      return;
    } else {
      console.error('elasticsearch_db: ', error);
    }
  }

  if (!error && response) {
    response = response._source;

    if (response) {
      response = response.val;
    }

    response = JSON.stringify(response);
  }

  callback(error, response);
};
