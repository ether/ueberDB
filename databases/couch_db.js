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
const nano = require('nano');
const async = require('async');

const DESIGN_NAME = 'ueberDb';
const DESIGN_PATH = `_design/${DESIGN_NAME}`;

const handleError = (er) => {
  if (er) throw new Error(er);
};

exports.Database = class extends AbstractDatabase {
  constructor(settings) {
    super();
    this.db = null;
    this.client = null;
    this.settings = settings;

    // force some settings
    // used by CacheAndBufferLayer.js
    this.settings.cache = 1000;
    this.settings.writeInterval = 100;
    this.settings.json = false;
  }

  init(callback) {
    const settings = this.settings;
    let client = null;
    let db = null;

    const config = {
      url: `http://${settings.host}:${settings.port}`,
      requestDefaults: {
        pool: {
          maxSockets: settings.maxListeners || 1,
        },
        auth: {
          user: settings.user,
          pass: settings.password,
        },
      },
    };

    const createDb = () => {
      client.db.create(settings.database, (er, body) => {
        if (er) return callback(er);
        return setDb();
      });
    };

    const setDb = () => {
      db = client.use(settings.database);
      checkUeberDbDesignDocument(db);
      this.client = client;
      this.db = db;
      callback();
    };

    // Always ensure that couchDb has at least an empty design doc for UeberDb use
    // this will be necessary for the `findKeys` method
    const checkUeberDbDesignDocument = () => {
      db.head(DESIGN_PATH, (er, _, header) => {
        if (er && er.statusCode === 404) return db.insert({views: {}}, DESIGN_PATH, handleError);
        if (er) throw new Error(er);
      });
    };

    client = nano(config);
    client.db.get(settings.database, (er, body) => {
      if (er && er.statusCode === 404) return createDb();
      if (er) return callback(er);
      return setDb();
    });
  }

  get(key, callback) {
    const db = this.db;
    db.get(key, (er, doc) => {
      if (er && er.statusCode !== 404) {
        console.log('GET');
        console.log(er);
      }
      if (doc == null) return callback(null, null);
      callback(null, doc.value);
    });
  }

  findKeys(key, notKey, callback) {
    const regex = this.createFindRegex(key, notKey);
    const queryKey = `${key}__${notKey}`;
    const db = this.db;

    // always look up if the query haven't be done before
    const checkQuery = () => {
      db.get(DESIGN_PATH, (er, doc) => {
        handleError(er);
        const queryExists = queryKey in doc.views;
        if (!queryExists) return createQuery(doc);
        makeQuery();
      });
    };

    // Cache the query for faster reuse in the future
    const createQuery = (doc) => {
      const mapFunction = {
        map: `function (doc) { if (${regex}.test(doc._id)) { emit(doc._id, null); } }`,
      };
      doc.views[queryKey] = mapFunction;
      db.insert(doc, DESIGN_PATH, (er) => {
        handleError(er);
        makeQuery();
      });
    };

    // If this is the first time the request is used, this can take a while…
    const makeQuery = (er) => {
      db.view(DESIGN_NAME, queryKey, (er, docs) => {
        handleError(er);
        docs = docs.rows.map((doc) => doc.key);
        callback(null, docs);
      });
    };

    checkQuery();
  }

  set(key, value, callback) {
    const db = this.db;
    db.get(key, (er, doc) => {
      if (doc == null) return db.insert({_id: key, value}, callback);
      db.insert({_id: key, _rev: doc._rev, value}, callback);
    });
  }

  remove(key, callback) {
    const db = this.db;
    db.head(key, (er, _, header) => {
      if (er && er.statusCode === 404) return callback(null);
      if (er) return callback(er);
      // etag has additional quotation marks, remove them
      const etag = JSON.parse(header).etag;
      db.destroy(key, etag, (er, body) => {
        if (er) return callback(er);
        callback(null);
      });
    });
  }

  doBulk(bulk, callback) {
    const db = this.db;
    const keys = bulk.map((op) => op.key);
    const revs = {};
    const setters = [];
    async.series([
      (callback) => {
        db.fetchRevs({keys}, (er, r) => {
          if (er) throw new Error(JSON.stringify(er));
          const rows = r.rows;
          for (const j in r.rows) {
            // couchDB will return error instead of value if key does not exist
            if (rows[j].value != null) revs[rows[j].key] = rows[j].value.rev;
          }
          callback();
        });
      },
      (callback) => {
        for (const item of bulk) {
          const set = {_id: item.key};
          if (revs[item.key] != null) set._rev = revs[item.key];
          if (item.type === 'set') set.value = item.value;
          if (item.type === 'remove') set._deleted = true;
          setters.push(set);
        }
        callback();
      },
    ], (err) => {
      db.bulk({docs: setters}, callback);
    });
  }

  close(callback) {
    if (callback) callback();
  }
};
