// initialize w/ default settings
var crateSettings = {
    schema : 'doc',
    table  : 'store',
    hosts  : 'http://localhost:4200'
}

var insertSQL;
var removeSQL;

exports.database = function(settings)
{
  this.db = crate;
  this.settings = settings || {};

  // update settings if thex where provided
  if(this.settings.hosts != null) {
      crateSettings.hosts = this.settings.hosts;
  }

  if(this.settings.schema != null) {
      crateSettings.schema = this.settings.schema;
  }

  if(this.settings.table != null) {
      crateSettings.table = this.settings.table;
  }

  crateSettings.fqn = '"' + crateSettings.schema + '"."' + crateSettings.table + '"'
}

var crate = require("node-crate");

/**
 * Initialize the crate client, then crate the table if it not exists
 */
exports.database.prototype.init = function(callback)
{
  this.db.connect(crateSettings.hosts);
  insertSQL = 'INSERT INTO ' + crateSettings.fqn +' ("key","value") VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)';
  removeSQL = 'DELETE FROM ' + crateSettings.fqn + ' WHERE key=? ';

  finish = function(log){
      callback();
  }

  var stmt = "CREATE TABLE IF NOT EXISTS "+crateSettings.fqn +
             " (key string primary key, value string) ";
  crate.execute(stmt).success(finish).error(finish);
}

/**
 * read from database
 */
exports.database.prototype.get = function (key, callback)
{
    finish = function(log){
        if(!log.rows.length){
            callback(undefined, null);
        } else {
            callback(undefined, log.rows[0][0]);
        }
    }
    finishError = function(log){
        callback(log, null);
    }
    crate.execute ("select value from "+ crateSettings.fqn+" where key = ?", [key])
        .success (finish)
        .error(finishError);
}

exports.database.prototype.findKeys = function (key, notKey, callback)
{
    var query = "SELECT key FROM "+ crateSettings.fqn +" where key LIKE ?", 
        params =[];
    key=key.replace(/\*/g,'%');
    params.push(key);
    if(notKey!=null && notKey != undefined){
      //not desired keys are notKey, e.g. %:%:%
      notKey=notKey.replace(/\*/g,'%');
      query+=" AND key NOT LIKE ?"
      params.push(notKey);
    }
    crate.execute (query, params).
        success(function (log) {
          if(!log.rows.length){
            callback(undefined, []);
          } else {
            res = []
            for (var i=0; i < log.rows.length; i++) {
                res[i] = log.rows[i][0];
            }
            callback(undefined, res);
          }
        })
        .error(function (log) {
            callback(log, null);
        });
}

exports.database.prototype.set = function (key, value, callback)
{
    crate.execute (insertSQL, [key, value]).
        success(refresh(function (log) {
            callback();
        }))
        .error(function (log) {
            callback(log, null);
        });
}

exports.database.prototype.remove = function (key, callback)
{
    crate.execute (removeSQL, [key]).
        success(function (log) {
            callback();
        })
        .error(function (log) {
            callback(log, null);
        });
}

exports.database.prototype.doBulk = function (bulk, callback)
{ 
    var remove = [];
    var insert = [];
    for(var i in bulk) {
        if(bulk[i].type == "set")
        {
            insert.push([bulk[i].key, bulk[i].value]);
        } else if(bulk[i].type == "remove") {
            remove.push([bulk[i].key]);
        }
    }
    error = function(log){
        console.error("error: "+log);
        callback(log, null);
    }
    finishUpdate = function(log){
        if(remove.length){
            crate.executeBulk(removeSQL, remove)
                .success(refresh(function (log) {
                    callback();
                }
            )).error(error);
        } else {
            callback();
        }
    }

    if(insert.length){
        crate.executeBulk(insertSQL, insert)
            .success(refresh(finishUpdate))
            .error(error);
    } else if(remove.length){
        crate.executeBulk(removeSQL, remove)
            .success(refresh(function (log) {
                callback();
            }))
            .error(errorRemove);
    }
}

function refresh(callback) {
    crate.execute("refresh table " + crateSettings.fqn).success(callback).error(
        function (log) {
            console.error("error: "+log);
        }
    );
}

exports.database.prototype.close = function(callback)
{
    callback();
}
