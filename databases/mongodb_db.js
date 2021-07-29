'use strict';
/**
 * 2020 Sylchauf
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

exports.Database = class extends AbstractDatabase {
  constructor(settings) {
    super();
    this.settings = settings;

    if (!this.settings.url) throw new Error('You must specify a mongodb url');
    // For backwards compatibility:
    if (this.settings.database == null) this.settings.database = this.settings.dbName;

    if (!this.settings.collection) this.settings.collection = 'ueberdb';
  }

  clearPing() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  schedulePing() {
    this.clearPing();
    this.interval = setInterval(() => {
      this.database.command({
        ping: 1,
      });
    }, 10000);
  }

  init(callback) {
    const MongoClient = require('mongodb').MongoClient;

    MongoClient.connect(this.settings.url, (err, client) => {
      if (!err) {
        this.client = client;
        this.database = client.db(this.settings.database);
        this.collection = this.database.collection(this.settings.collection);
      }

      callback(err);
    });

    this.schedulePing();
  }

  get(key, callback) {
    this.collection.findOne({_id: key}, (err, document) => {
      if (err) callback(err);
      else callback(null, document ? document.value : null);
    });

    this.schedulePing();
  }

  findKeys(key, notKey, callback) {
    const selector = {
      $and: [
        {_id: {$regex: `${key.replace(/\*/g, '')}`}},
      ],
    };

    if (notKey) {
      selector.$and.push({_id: {$not: {$regex: `${notKey.replace(/\*/g, '')}`}}});
    }

    this.collection.find(selector, async (err, res) => {
      if (err) {
        callback(err);
      } else {
        const data = await res.toArray();

        callback(null, data.map((i) => i._id));
      }
    });

    this.schedulePing();
  }

  set(key, value, callback) {
    if (key.length > 100) {
      callback('Your Key can only be 100 chars');
    } else {
      this.collection.update({_id: key}, {$set: {value}}, {upsert: true}, callback);
    }

    this.schedulePing();
  }

  remove(key, callback) {
    this.collection.remove({_id: key}, callback);

    this.schedulePing();
  }

  doBulk(bulk, callback) {
    const bulkMongo = this.collection.initializeOrderedBulkOp();

    for (const i in bulk) {
      if (bulk[i].type === 'set') {
        bulkMongo.find({_id: bulk[i].key}).upsert().updateOne({$set: {value: bulk[i].value}});
      } else if (bulk[i].type === 'remove') {
        bulkMongo.find({_id: bulk[i].key}).deleteOne();
      }
    }

    bulkMongo.execute().then((res) => {
      callback(null, res);
    }).catch((error) => {
      callback(error);
    });

    this.schedulePing();
  }

  close(callback) {
    this.clearPing();
    this.client.close(callback);
  }
};
