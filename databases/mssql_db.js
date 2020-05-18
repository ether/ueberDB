/**
 * 2019 - exspecto@gmail.com
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
 *
 *
 * Note: This requires MS SQL Server >= 2008 due to the usage of the MERGE statement
 *
 */

var async = require("async");
var mssql = require("mssql");

exports.database = function(settings) {

  settings = settings || {};

  if (settings.json != null) {
    settings.parseJSON = settings.json;
  }

  //set the request timeout to 5 minutes
  settings.requestTimeout = 300000;

  settings.server = settings.host;
  this.settings = settings;

  /*
    Turning off the cache and write buffer here. You
    can reenable it, but also take a look at maxInserts in
    the doBulk function to decide how you want to split it up.
  */
  this.settings.cache = 0;
  this.settings.writeInterval = 0;

};

exports.database.prototype.init = function(callback) {

  var sqlCreate =
    "IF OBJECT_ID(N'dbo.store', N'U') IS NULL" +
    "  BEGIN" +
    "    CREATE TABLE [store] (" +
    "      [key] NVARCHAR(100) PRIMARY KEY," +
    "      [value] NTEXT NOT NULL" +
    "    );" +
    "  END";

  new mssql.ConnectionPool(this.settings).connect().then(pool => {
    this.db = pool;

    var request = new mssql.Request(this.db);

    request.query(sqlCreate, function(err) {
      callback(err);
    });

    this.db.on("error", err => {
      console.log(err);
    });
  });

};

exports.database.prototype.get = function(key, callback) {

  var request = new mssql.Request(this.db);

  request.input("key", mssql.NVarChar(100), key);

  request.query("SELECT [value] FROM [store] WHERE [key] = @key", function(err, results) {
    var value = null;

    if (!err && results.rowsAffected[0] == 1) {
      value = results.recordset[0].value;
    }

    callback(err, value);
  });

};

exports.database.prototype.findKeys = function(key, notKey, callback) {

  var request = new mssql.Request(this.db);
  var query = "SELECT [key] FROM [store] WHERE [key] LIKE @key";

  //desired keys are key, e.g. pad:%
  key = key.replace(/\*/g, "%");

  request.input("key", mssql.NVarChar(100), key);

  if (notKey != null && notKey != undefined) {
    //not desired keys are notKey, e.g. %:%:%
    notKey = notKey.replace(/\*/g, "%");
    request.input("notkey", mssql.NVarChar(100), notKey);
    query += " AND [key] NOT LIKE @notkey";
  }

  request.query(query, function(err, results) {
    var value = [];

    if (!err && results.rowsAffected[0] > 0) {
      for (i = 0; i < results.recordset.length; i++) {
        value.push(results.recordset[i].key);
      }
    }

    callback(err, value);
  });

};

exports.database.prototype.set = function(key, value, callback) {

  var request = new mssql.Request(this.db);

  if (key.length > 100) {
    callback("Your Key can only be 100 chars");
  } else {
    var query =
      "MERGE [store] t USING (SELECT @key [key], @value [value]) s" +
      " ON t.[key] = s.[key]" +
      " WHEN MATCHED AND s.[value] IS NOT NULL THEN UPDATE SET t.[value] = s.[value]" +
      " WHEN NOT MATCHED THEN INSERT ([key], [value]) VALUES (s.[key], s.[value]);";

    request.input("key", mssql.NVarChar(100), key);
    request.input("value", mssql.NText, value);

    request.query(query, function(err, info) {
      callback(err);
    });
  }

};

exports.database.prototype.remove = function(key, callback) {

  var request = new mssql.Request(this.db);
  request.input("key", mssql.NVarChar(100), key);
  request.query("DELETE FROM [store] WHERE [key] = @key", callback);

};

exports.database.prototype.doBulk = function(bulk, callback) {

  var maxInserts = 100;
  var request = new mssql.Request(this.db);
  var firstReplace = true;
  var firstRemove = true;
  var replacements = [];
  var removeSQL = "DELETE FROM [store] WHERE [key] IN (";

  for (var i in bulk) {

    if (bulk[i].type === "set") {

      if (firstReplace) {
        replacements.push("BEGIN TRANSACTION;");
        firstReplace = false;
      } else if (i % maxInserts == 0) {
        replacements.push("\nCOMMIT TRANSACTION;\nBEGIN TRANSACTION;\n");
      }

      replacements.push(`MERGE [store] t USING (SELECT '${bulk[i].key}' [key], '${bulk[i].value}' [value]) s
                   ON t.[key] = s.[key]
                   WHEN MATCHED AND s.[value] IS NOT NULL THEN UPDATE SET t.[value] = s.[value]
                   WHEN NOT MATCHED THEN INSERT ([key], [value]) VALUES (s.[key], s.[value]);`);

    } else if (bulk[i].type === "remove") {

      if (!firstRemove) {
        removeSQL += ",";
      }

      firstRemove = false;
      removeSQL += `'${bulk[i].key}'`;

    }

  }

  removeSQL += ");";
  replacements.push("COMMIT TRANSACTION;");

  async.parallel(
    [
      function(callback) {
        if (!firstReplace) {
          request.batch(replacements.join("\n"), function(err, results) {
            if (err) {
              callback(err);
            }
            callback(err, results);
          });
        } else {
          callback();
        }
      },
      function(callback) {
        if (!firstRemove) {
          request.query(removeSQL, callback);
        } else {
          callback();
        }
      }
    ],
    function(err, results) {
      if (err) {
        callback(err);
      }
      callback(err, results);
    }
  );

};

exports.database.prototype.close = function(callback) {

  this.db.close(callback);

};

