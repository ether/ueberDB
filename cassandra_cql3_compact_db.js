/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var CassandraUtil = require('./cassandra/util');
var util = require('util');

/**
 * Cassandra DB constructor.
 *
 * @param  {Object}     settings                    The required settings object to create a Cassandra pool.
 * @param  {String[]}   settings.hosts              An array of '<ip>:<port>' strings that are running the Cassandra database.
 * @param  {String}     settings.keyspace           The keyspace that should be used, it's assumed that the keyspace already exists.
 * @param  {String}     settings.cfName             The prefix for the column families that should be used to store data. The column families will be created if they don't exist.
 * @param  {String}     [settings.user]             A username that should be used to authenticate with Cassandra (optional.)
 * @param  {String}     [settings.pass]             A password that should be used to authenticate with Cassandra (optional.)
 * @param  {Number}     [settings.timeout]          The time (defined in ms) when a query has been considered to time-out (Optional, default 3000.)
 * @param  {Number}     [settings.replication]      The replication factor to use. (Optional, default 1.)
 * @param  {String}     [settings.strategyClass]    The strategyClass to use (Optional, default 'SimpleStrategy'.)
 */
exports.database = function(settings) {
  var self = this;
  self.settings = CassandraUtil.createConfig(settings);
  self.settings.cqlVersion = '3.0.0';
};

/**
 * Initializes the Cassandra pool, connects to cassandra and creates the table if it didn't exist already.
 *
 * @param  {Function}   callback        Standard callback method.
 * @param  {Error}      callback.err    An error object (if any.)
 */
exports.database.prototype.init = function(callback) {
  var self = this;

  // The query and parameters that can be used to create the etherpad column family
  var createCfQuery = {
    'cql': util.format('CREATE TABLE "%s" ("key" text, "column1" text, "value" text, PRIMARY KEY ("key", "column1")) WITH COMPACT STORAGE', self.settings.cfName),
    'parameters': []
  };

  // Initialize the cassandra connection pool, creating the table if necessary
  CassandraUtil.initPool(self.settings, createCfQuery, function(err, pool) {
    if (err) {
      return callback(err);
    }

    self.pool = pool;
    callback();
  });
};

/**
 * Gets a value from Cassandra.
 *
 * @param  {String}     key             The key for which the value should be retrieved.
 * @param  {Function}   callback        Standard callback method.
 * @param  {Error}      callback.err    An error object (if any.)
 * @param  {String}     callback.value  The value for the given key (if any.)
 */
exports.database.prototype.get = function (key, callback) {
  var self = this;
  self.pool.cql(util.format('SELECT "value" FROM "%s" WHERE "key" = ? AND "column1" = ?', self.settings.cfName), [ key, 'data' ], function (err, rows) {
    if (err) {
      return callback(err);
    } else if (rows.length === 0) {
      return callback(null, null);
    }

    callback(null, rows[0].get('value').value);
  });
};

/**
 * Cassandra has no native `findKeys` method. This function implements a naive filter by retrieving *all* the keys and filtering those.
 * This should obviously be used with the utmost care and is probably not something you want to run in production.
 *
 * @param  {String}     key             The filter for keys that should match.
 * @param  {String}     [notKey]        The filter for keys that shouldn't match.
 * @param  {Function}   callback        Standard callback method
 * @param  {Error}      callback.err    Error object in case something goes wrong.
 * @param  {String[]}   callback.keys   An array of keys that match the specified filters.
 */
exports.database.prototype.findKeys = function (key, notKey, callback) {
  var self = this;
  var cql = null;
  if (!notKey) {
    // Get all the keys.
    self.pool.cql(util.format('SELECT "key" FROM "%s"', self.settings.cfName), [], function (err, rows) {
      if (err) {
        return callback(err);
      }

      var keys = [];
      rows.forEach(function(row) {
        keys.push(row.get('key').value);
      });

      callback(null, keys);
    });

  } else if (notKey === '*:*:*') {
    // restrict key to format 'text:*'
    var matches = /^([^:]+):\*$/.exec(key);
    if (matches) {
      // Get the 'text' bit out of the key and get all those keys from a special column.
      // We can retrieve them from this column as we're duplicating them on .set/.remove
      self.pool.cql(util.format('SELECT * from "%s" WHERE "key" = ?', self.settings.cfName), [ 'ueberdb:keys:' + matches[1] ], function (err, rows) {
        if (err) {
          return callback(err);
        } else if (rows.length === 0) {
          return callback(null, []);
        }

        var keys = [];
        rows.forEach(function(row) {
          keys.push(row.get('column1').value);
        });

        return callback(null, keys);
      });
    } else {
      return callback(new customError('Cassandra db only supports key patterns like pad:* when notKey is set to *:*:*', 'apierror'), null);
    }
  } else {
    return callback(new customError('Cassandra db currently only supports *:*:* as notKey', 'apierror'), null);
  }
};

/**
 * Sets a value for a key.
 *
 * @param  {String}     key         The key to set.
 * @param  {String}     value           The value associated to this key.
 * @param  {Function}   callback        Standard callback method.
 * @param  {Error}      callback.err    Error object in case something goes wrong.
 */
exports.database.prototype.set = function (key, value, callback) {
  this.doBulk([{'type': 'set', 'key': key, 'value': value}], callback);
};

/**
 * Removes a key and it's value from the column family.
 *
 * @param  {String}     key             The key to remove.
 * @param  {Function}   callback        Standard callback method.
 * @param  {Error}      callback.err    Error object in case something goes wrong.
 */
exports.database.prototype.remove = function (key, callback) {
  this.doBulk([{'type': 'remove', 'key': key}], callback);
};

/**
 * Performs multiple operations in one action. Note that these are *NOT* atomic and any order is not guaranteed.
 *
 * @param  {Object[]}   bulk            The set of operations that should be performed.
 * @param  {Function}   callback        Standard callback method.
 * @param  {Error}      callback.err    Error object in case something goes wrong.
 */
exports.database.prototype.doBulk = function (bulk, callback) {
  var self = this;
  var query = 'BEGIN BATCH \n';
  var parameters = [];
  bulk.forEach(function(operation) {
    var matches = /^([^:]+):([^:]+)$/.exec(operation.key);
    if (operation.type === 'set') {
      query += util.format('UPDATE "%s" SET "value" = ? WHERE "key" = ? AND "column1" = ?; \n', self.settings.cfName);
      parameters.push(operation.value);
      parameters.push(operation.key);
      parameters.push('data');

      if (matches) {
        query += util.format('UPDATE "%s" SET "value" = ? WHERE "key" = ? AND "column1" = ?; \n', self.settings.cfName);
        parameters.push('1');
        parameters.push('ueberdb:keys:' + matches[1]);
        parameters.push(matches[0]);
      }

    } else if (operation.type === 'remove') {
      query += util.format('DELETE FROM "%s" WHERE "key" = ?', self.settings.cfName);
      parameters.push(operation.key);

      if (matches) {
        query += util.format('DELETE FROM "%s" WHERE "key" = ? AND "column1" = ?', self.settings.cfName);
        parameters.push('ueberdb:keys:' + matches[1]);
        parameters.push(matches[0]);
      }
    }
  });
  query += 'APPLY BATCH;';
  self.pool.cql(query, parameters, callback);
};

/**
 * Closes the Cassandra connection.
 *
 * @param  {Function}   callback        Standard callback method.
 * @param  {Error}      callback.err    Error object in case something goes wrong.
 */
exports.database.prototype.close = function(callback) {
  var self = this;
  self.pool.once('close', callback);
  self.pool.close();
};
