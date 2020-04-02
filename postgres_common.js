/**
 * 2011 Peter 'Pita' Martischka
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

var async = require("async");

exports.init = function(callback)
{
  var testTableExists = "SELECT 1 as exists FROM pg_tables WHERE tablename = 'store'";

  var createTable = 'CREATE TABLE store (' +
    '"key" character varying(100) NOT NULL, ' +
    '"value" text NOT NULL, ' +
    'CONSTRAINT store_pkey PRIMARY KEY (key))';

  var _this = this;

  // this variable will be given a value depending on the result of the
  // feature detection
  _this.upsertStatement = null;

  /*
   * - Detects if this Postgres version supports INSERT .. ON CONFLICT
   *   UPDATE (PostgreSQL >= 9.5 and CockroachDB)
   * - If upsert is not supported natively, creates in the DB a pl/pgsql
   *   function that emulates it
   * - Performs a side effect, setting _this.upsertStatement to the sql
   *   statement that needs to be used, based on the detection result
   * - calls the callback
   */
  function detectUpsertMethod(callback) {
    var upsertViaFunction = "SELECT ueberdb_insert_or_update($1,$2)";
    var upsertNatively    = "INSERT INTO store(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value";
    var createFunc = "CREATE OR REPLACE FUNCTION ueberdb_insert_or_update(character varying, text) " +
      "RETURNS void AS $$ " +
      "BEGIN " +
      "  IF EXISTS( SELECT * FROM store WHERE key = $1 ) THEN " +
      "    UPDATE store SET value = $2 WHERE key = $1; " +
      "  ELSE " +
      "    INSERT INTO store(key,value) VALUES( $1, $2 ); " +
      "  END IF; "+
      "  RETURN; " +
      "END; " +
      "$$ LANGUAGE plpgsql;";

    var testNativeUpsert = "EXPLAIN " + upsertNatively;

    _this.db.query(testNativeUpsert, ["test-key", "test-value"], function(err) {
      if (err) {
        // the UPSERT statement failed: we will have to emulate it via
        // an sql function
        _this.upsertStatement = upsertViaFunction;

        // actually create the emulation function
        _this.db.query(createFunc, [], callback);

        return;
      }

      // if we get here, the EXPLAIN UPSERT succeeded, and we can use a
      // native UPSERT
      _this.upsertStatement = upsertNatively;
      callback();
    });
  }

  this.db.query(testTableExists, function(err, result) {
    if (result.rows.length == 0) {
      _this.db.query(createTable, detectUpsertMethod(callback));
    } else {
      detectUpsertMethod(callback);
    }
  });
}

exports.get = function(key, callback)
{
  this.db.query("SELECT value FROM store WHERE key=$1", [key], function(err,results)
  {
    var value = null;

    if(!err && results.rows.length == 1)
    {
      value = results.rows[0].value;
    }

    callback(err,value);
  });
}

exports.findKeys = function(key, notKey, callback)
{
  var query="SELECT key FROM store WHERE  key LIKE $1"
    , params=[]
  ;
  //desired keys are %key:%, e.g. pad:%
  key=key.replace(/\*/g,'%');
  params.push(key);

  if(notKey!=null && notKey != undefined){
    //not desired keys are notKey:%, e.g. %:%:%
    notKey=notKey.replace(/\*/g,'%');
    query+=" AND key NOT LIKE $2"
    params.push(notKey);
  }
  this.db.query(query, params, function(err,results)
  {
    var value = [];

    if(!err && results.rows.length > 0)
    {
      results.rows.forEach(function(val){
        value.push(val.key);
      });
    }

    callback(err,value);
  });
}

exports.set = function(key, value, callback)
{
  if(key.length > 100)
  {
    callback("Your Key can only be 100 chars");
  }
  else
  {
    this.db.query(_this.upsertStatement, [key,value], callback);
  }
}

exports.remove = function(key, callback)
{
  this.db.query("DELETE FROM store WHERE key=$1", [key], callback);
}

exports.doBulk = function(bulk, callback)
{
  var _this = this;

  var replaceVALs = new Array();
  var removeSQL = "DELETE FROM store WHERE key IN ("
  var removeVALs = new Array();

  var removeCount = 0;

  for(var i in bulk)
  {
    if(bulk[i].type == "set")
    {
      replaceVALs.push([bulk[i].key, bulk[i].value]);
    }
    else if(bulk[i].type == "remove")
    {
      if(removeCount != 0)
        removeSQL+=",";
      removeCount += 1;

      removeSQL+= "$" + removeCount;
      removeVALs.push(bulk[i].key);
    }
  }

  removeSQL+=");";

  let functions = []

  for (let v in replaceVALs) {
    const f = function (callback) {
      return _this.db.query(_this.upsertStatement, replaceVALs[v], callback);
    }

    functions.push(f)
  }

  const removeFunction = function(callback) {
    if(!removeVALs.length < 1)
      _this.db.query(removeSQL, removeVALs, callback);
    else
      callback();
  }
  functions.push(removeFunction)

  async.parallel(functions, callback);
}
