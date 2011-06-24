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

var mysql = require("mysql");
var async = require("async");

exports.database = function(settings)
{
  this.db = new mysql.Client();
  
  this.settings = settings;
  
  if(this.settings.host != null)
    this.db.host = this.settings.host;
    
  if(this.settings.port != null)
    this.db.port = this.settings.port;
    
  if(this.settings.user != null)
    this.db.user = this.settings.user;
  
  if(this.settings.password != null)
    this.db.password = this.settings.password;
    
  if(this.settings.database != null)
    this.db.database = this.settings.database;
  
  this.settings.cache = 1000;
  this.settings.writeInterval = 100;
  this.settings.json = true;
}

exports.database.prototype.init = function(callback)
{
  var _this = this;

  async.waterfall([
    function(callback)
    {
      _this.db.connect(callback);
    },
    function(result, callback)
    {
      var sql = "CREATE TABLE IF NOT EXISTS `store` ( " +
                "`key` VARCHAR( 100 ) NOT NULL , " + 
                "`value` LONGTEXT NOT NULL , " + 
                "PRIMARY KEY (  `key` ) " +
                ") ENGINE = INNODB;";
      _this.db.query(sql,[],callback);
    } 
  ],function(err, info){
      callback(err);
  });
}

exports.database.prototype.get = function (key, callback)
{
  var sql = this.db.format("SELECT `value` FROM  `store` WHERE  `key` = ?", [key]);
  this.db.query(sql, [], function(err,results)
  {
    var value = null;
    
    if(!err && results.length == 1)
    {
      value = results[0].value;
    }
  
    callback(err,value);
  });
}

exports.database.prototype.set = function (key, value, callback)
{
  if(key.length > 100)
  {
    callback("Your Key can only be 100 chars");
  }
  else
  {
    this.db.query("REPLACE INTO `store` VALUES (?,?)", [key, value], function(err, info){
      callback(err);
    });
  }
}

exports.database.prototype.remove = function (key, callback)
{
  this.db.query("DELETE FROM `store` WHERE `key` = ?", [key], callback);
}

exports.database.prototype.doBulk = function (bulk, callback)
{ 
  var sql = "START TRANSACTION;\n";
  for(var i in bulk)
  {
    if(bulk[i].type == "set")
    {
      sql+="REPLACE INTO `store` VALUES (" + this.db.escape(bulk[i].key) + ", " + this.db.escape(bulk[i].value) + ");\n";
    }
    else if(bulk[i].type == "remove")
    {
      sql+="DELETE FROM `store` WHERE `key` = " + this.db.escape(bulk[i].key) + ";\n";
    }
  }
  sql += "COMMIT;";
  
  this.db.query(sql, function(err){
    if(err)
    {
      console.error("ERROR WITH SQL: ");
      console.error(sql);
    }
    
    callback(err);
  });
}

exports.database.prototype.close = function(callback)
{
  this.db.end(callback);
}
