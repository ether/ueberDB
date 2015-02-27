
var helenus = require('helenus');

/**
 * Use the ueberDB database settings object to create the helenus configuration object
 * for initializing the cassandra connection pool.
 *
 * @param  {Object}   settings    The ueberDB database configuration
 * @return {Object}               The Helenus ConnectionPool configuration
 * @throws {Error}                If the configuration is invalid or missing required parameters
 */
var createConfig = module.exports.createConfig = function(settings) {
  if (!settings.hosts || settings.hosts.length === 0) {
    throw new Error('The Cassandra hosts should be defined.');
  }
  if (!settings.keyspace) {
    throw new Error('The Cassandra keyspace should be defined.');
  }
  if (!settings.cfName) {
    throw new Error('The Cassandra column family should be defined.');
  }

  var config = {};
  config.hosts = settings.hosts;
  config.keyspace = settings.keyspace;
  config.cfName = settings.cfName;
  if (settings.user) {
    config.user = settings.user;
  }
  if (settings.pass) {
    config.pass = settings.pass;
  }
  config.timeout = parseInt(settings.timeout, 10) || 3000;
  config.replication = parseInt(settings.replication, 10) || 1;
  config.strategyClass = settings.strategyClass || 'SimpleStrategy';
  return config;
};

/**
 * Initialize the helenus ConnectionPool using the helenus configuration. The ColumnFamily
 * for the etherpad content will be created if it does not already exist, using the
 * provided `createCfQuery` parameter.
 *
 * @param  {Object}   config                    The Helenus ConnectionPool configuration object
 * @param  {Object}   createCfQuery             The query data to create the CF, if needed
 * @param  {String}   createCfQuery.cql         The CQL query that will create the CF
 * @param  {Array}    createCfQuery.parameters  The parameters for the CQL query
 * @param  {Function} callback                  Invoked when the pool is initialized
 * @param  {Error}    callback.err              An error that occurred, if any
 */
var initPool = module.exports.initPool = function(config, createCfQuery, callback) {
  // Create pool
  var pool = new helenus.ConnectionPool(config);
  pool.on('error', function(err) {
    // We can't use the callback method here, as this is a generic error handler.
    console.error(err);
  });

  // Connect to it.
  pool.connect(function(err) {
    if (err) {
      return callback(err);
    }

    // Get a description of the keyspace so we can determine whether or not the CF exist.
    pool.getConnection()._client.describe_keyspace(config.keyspace, function(err, definition) {
      if (err && err.name) {
        // If the keyspace doesn't exist, an error will be promoted here
        return callback(err);
      }

      // Iterate over all the column families and check if the desired one exists.
      var exists = false;
      definition.cf_defs.forEach(function(cf) {
        if (cf.name === config.cfName) {
          exists = true;
        }
      });

      if (exists) {
        // The CF exists, we're done here.
        callback(null, pool);
      } else {
        // Create the CF
        pool.cql(createCfQuery.cql, createCfQuery.parameters, function(err) {
          if (err) {
            callback(err);
            return;
          }

          callback(null, pool);
        });
      }
    });
  });
};