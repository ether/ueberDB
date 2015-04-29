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

var nano            = require('nano');
var async           = require('async');

var DESIGN_NAME     = 'ueberDb';
var DESIGN_PATH     = '_design/' + DESIGN_NAME;

var handleError = function handleError(er) {
  if (er) throw new Error(er);
};

exports.database = function(settings) {
  this.db       = null;
  this.client   = null;
  this.settings = settings;

  // force some settings
  // used by CacheAndBufferLayer.js
  this.settings.cache = 1000;
  this.settings.writeInterval = 100;
  this.settings.json = false;
};

exports.database.prototype.init = function(callback) {
  var settings  = this.settings;
  var client    = null;
  var db        = null;

  var config    = {
    url: 'http://' + settings.host + ':' + settings.port,
    requestDefaults: {
      pool: {
        maxSockets: settings.maxListeners || 1,
      },
      auth: {
        user: settings.user,
        pass: settings.password
      },
    },
  };

  var createDb = function createDb() {
    client.db.create(settings.database, function(er, body) {
      if (er) return callback(er);
      return setDb();
    });
  };

  var setDb = function setDb() {
    db = client.use(settings.database);
    checkUeberDbDesignDocument(db);
    this.client = client;
    this.db     = db;
    callback();
  }.bind(this);

  // Always ensure that couchDb has at least an empty design doc for UeberDb use
  // this will be necessary for the `findKeys` method
  var checkUeberDbDesignDocument = function checkUeberDbDesignDocument() {
    db.head(DESIGN_PATH, function(er, _, header) {
      if (er && er.statusCode === 404) return db.insert({views: {}}, DESIGN_PATH, handleError);
      if (er) throw new Error(er);
    });
  };

  client = nano(config);
  client.db.get(settings.database, function(er, body) {
    if (er && er.statusCode === 404) return createDb();
    if (er) return callback(er);
    return setDb();
  });
};

exports.database.prototype.get = function(key, callback) {
  var db = this.db;
  db.get(key, function(er, doc) {
    if (er && er.statusCode !== 404) {
      console.log('GET');
      console.log(er);
    };
    if (doc == null) return callback(null, null);
    callback(null, doc.value);
  });
};

exports.database.prototype.findKeys = function(key, notKey, callback) {
  var regex     = this.createFindRegex(key, notKey);
  var queryKey  = key + '__' + notKey;
  var db        = this.db;

  // always look up if the query haven't be done before
  var checkQuery = function checkQuery() {
    db.get(DESIGN_PATH, function(er, doc) {
      handleError(er);
      var queryExists = queryKey in doc.views;
      if (!queryExists) return createQuery(doc);
      makeQuery();
    });
  };

  // Cache the query for faster reuse in the future
  var createQuery = function createQuery(doc) {
    var mapFunction     = {
      map: 'function(doc) {' +
        'if (' + regex + '.test(doc._id)) {' +
          'emit(doc._id, null);' +
        '}' +
      '}',
    }
    doc.views[queryKey] = mapFunction;
    db.insert(doc, DESIGN_PATH, function(er) {
      handleError(er);
      makeQuery();
    })
  };

  // If this is the first time the request is used, this can take a while…
  var makeQuery = function makeQuery(er) {
    db.view(DESIGN_NAME, queryKey, function(er, docs) {
      handleError(er);
      docs = docs.rows.map(function(doc) { return doc.key; });
      callback(null, docs);
    });
  };

  checkQuery();
};

exports.database.prototype.set = function(key, value, callback) {
  var db = this.db;
  db.get(key, function(er, doc) {
    if (doc == null) return db.insert({_id: key, value: value}, callback);
    db.insert({_id: key, _rev: doc._rev, value: value}, callback);
  });
};

exports.database.prototype.remove = function(key, callback) {
  var db = this.db;
  db.head(key, function(er, _, header) {
    if (er && er.statusCode === 404) return callback(null);
    if (er) return callback(er)
    db.destroy(key, header.etag, function(er, body) {
      if (er) return callback(er);
      callback(null);
    });
  });
};

exports.database.prototype.doBulk = function(bulk, callback) {
  var db = this.db;
  var _this = this;
  var keys = [];
  var revs = {};
  var setters = [];
  for (var i in bulk) {
    keys.push(bulk[i].key);
  }
  async.series([
    function fetchRevs(callback) {
      db.fetchRevs({keys: keys}, function (er, r) {
        if (er) throw new Error(JSON.stringify(er));
        rows = r.rows;
        for (var j in r.rows) {
          // couchDB will return error instead of value if key does not exist
          if (rows[j].value != null) revs[rows[j].key] = rows[j].value.rev;
        }
        callback();
      });
    },
    function setActions(callback) {
      for (var i in bulk) {
        var item = bulk[i];
        var set = {_id: item.key};
        if (revs[item.key] != null) set._rev = revs[item.key];
        if (item.type === 'set')    set.value = item.value;
        if (item.type === 'remove') set._deleted = true;
        setters.push(set);
      }
      callback();
    }], function makeBulk(err) {
      db.bulk({docs: setters}, callback);
    }
  );
};

exports.database.prototype.close = function(callback) {
  if (callback) callback();
};
