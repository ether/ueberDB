/**
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
var fs = require('fs');
var MongoClient = require('mongodb').MongoClient;

/**
 * "settings" must be an object with the following properties:
 *   - host           (string): mandatory if no url is provided on settings
 *   - dbname         (string): mandatory if no url is provided on settings
 *   - port           (number): mandatory if no url is provided on settings
 *   - url            (string): full connection url, following the documentation on
 *                              https://docs.mongodb.com/manual/reference/connection-string/
 *   - user           (string)
 *   - password       (string)
 *   - extra          (object): optional connection settings, as described on
 *                              http://mongodb.github.io/node-mongodb-native/2.2/api/MongoClient.html#.connect
 *                              If using SSL, provide the file path(s) on properties
 *                              "sslCAPath", "sslKeyPath", and/or "sslKeyPath", and file content
 *                              will be loaded into the appropriate setting
 *   - collectionName (string): defaults to "store"
 *
 * Example:
 * {
 *    "url": "mongodb://user:password@my.server.com:27017,my.other.server.com:27018/theDBName?ssl=true",
 *    "extra": {
 *      "mongos": {
 *        "ssl": true,
 *        "sslValidate": true,
 *        "sslCAPath": "/config/the-ca.pem"
 *      }
 *    }
 * }
 */
exports.database = function(settings) {
  var assertions = {
    exist: function(v) {return v !== undefined && v !== null},
    isString: function(v) {return typeof v === 'string'},
    isNumber: function(v) {return typeof v === 'number'},
  }
  var assert = function(value, assertion, message) { if (!assertion(value)) throw message }

  assert(settings, assertions.exist, 'you need to inform the settings');

  // some settings are only necessary when the full url is not provided
  if (!settings.url) {
    assert(settings.host, assertions.isString, 'you need to inform a valid host (string)');
    assert(settings.dbname, assertions.isString, 'you need to inform a valid dbname (string)');
    assert(settings.port, assertions.isNumber, 'you need to inform a valid port (number)');
  }

  this.settings = settings;
  this.settings.collectionName = assertions.isString(this.settings.collectionName) ? this.settings.collectionName : 'store';

  // these values are used by CacheAndBufferLayer
  this.settings.cache = 1000;
  this.settings.writeInterval = 100;
  this.settings.json = true;
}

exports.database.prototype._loadSslCertificatesIntoSettings = function(rootSettings) {
  ['sslCA', 'sslKey', 'sslCert'].forEach(function(setting) {
    var settingPath = rootSettings[setting + 'Path'];

    if (settingPath) {
      rootSettings[setting] = fs.readFileSync(settingPath);

      // "sslCA" property needs to be replicated into a "ca" property on mongo 2.0
      // https://www.compose.com/articles/one-missing-key-and-how-it-broke-node-js-and-mongodb/
      if (setting === 'sslCA') {
        rootSettings['ca'] = rootSettings[setting];
      }
    }
  });
}

exports.database.prototype._buildExtraSettings = function(extraSettings) {
  extraSettings = extraSettings || {};
  var loadSslCertificates = this._loadSslCertificatesIntoSettings;

  [
    // mongodb 2.2: SSL settings are on root
    // http://mongodb.github.io/node-mongodb-native/2.2/tutorials/connect/ssl/
    extraSettings,
    // mongodb 2.0: SSL settings are on sub-levels, depending of where we're connecting to
    // http://mongodb.github.io/node-mongodb-native/2.0/reference/connecting/ssl/
    extraSettings.server,
    extraSettings.replset,
    extraSettings.mongos,
  ].forEach(function(rootSettings) {
    if (rootSettings) {
      loadSslCertificates(rootSettings);
    }
  });

  return extraSettings;
}

// Builds basic connection urls. Examples:
// var basicUrl = 'mongodb://<HOST>:<PORT>/<DB>';
// var urlWithAuthentication = 'mongodb://<USER>:<PASSWORD>@<HOST>:<PORT>/<DB>';
exports.database.prototype._buildUrl = function(settings) {
  var protocol = 'mongodb://';
  var authentication = settings.user && settings.password ? settings.user + ':' + settings.password + '@' : '';
  return protocol + authentication + settings.host + ':' + settings.port + '/' + settings.dbname
}

exports.database.prototype.init = function(callback) {
  this.onMongoReady = callback || function(){};

  var url = this.settings.url || this._buildUrl(this.settings);
  var options = this._buildExtraSettings(this.settings.extra);
  MongoClient.connect(url, options, this._onMongoConnect.bind(this));
}

exports.database.prototype._onMongoConnect = function(error, db) {
  if (error) {throw 'an error occurred [' + error + '] on mongo connect'}

  this.db = db;
  this.collection = this.db.collection(this.settings.collectionName);
  this.db.ensureIndex(this.settings.collectionName, {key: 1}, {unique:true, background:true}, function(err, indexName) {
    if (err) {
      console.error('Error creating index');
      console.error(err.stack ? err.stack : err);
    }
  });

  exports.database.prototype.set = function (key, value, callback) {
    this.collection.update({key: key}, {key: key, val: value}, {safe: true, upsert: true}, callback);
  }

  exports.database.prototype.get = function (key, callback) {
    this.collection.findOne({key: key}, function(err, doc) {
      var value = doc ? doc.val : doc;
      callback(err, value);
    });
  }

  exports.database.prototype.remove = function (key, callback) {
    this.collection.remove({key: key}, {safe: true}, callback);
  }

  exports.database.prototype.findKeys = function (key, notKey, callback) {
    var findRegex = this.createFindRegex(key, notKey);
    this.collection.find({key: findRegex}).toArray(function(err, docs) {
      docs = docs || [];
      var keys = docs.map(function(doc) { return doc.key });

      callback(err, keys);
    });
  }

  exports.database.prototype.doBulk = function (bulkOperations, callback) {
    var operations = {
      'set': 'updateOne',
      'remove': 'deleteOne',
    }

    var mongoBulkOperations = [];
    for (var i in bulkOperations) {
      var eachUeberOperation = bulkOperations[i];
      var mongoOperationType = operations[eachUeberOperation.type];
      var mongoOperationDetails = {
        filter: { key: eachUeberOperation.key } ,
        update: { $set: { val: eachUeberOperation.value } },
        upsert: true,
      };
      var eachBulk = {}
      eachBulk[mongoOperationType] = mongoOperationDetails;
      mongoBulkOperations.push(eachBulk);
    }

    this.collection.bulkWrite(mongoBulkOperations, callback);
  }

  exports.database.prototype.close = function (callback) {this.db.close(callback)}

  this.onMongoReady(error, this);
}
