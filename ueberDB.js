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

var dbWrapper = require("./dbWrapper");
var async = require("async");

/**
 The Constructor
*/
exports.database = function(type, dbSettings, wrapperSettings)
{
  if(!type)
  {
    type = "sqlite";
    dbSettings = null;
    wrapperSettings = null;
  }

  //saves all settings and require the db module
  this.type = type;
  this.db_module = require("./" + type + "_db");
  this.dbSettings = dbSettings; 
  this.wrapperSettings = wrapperSettings; 
}

exports.database.prototype.init = function(callback)
{
  var _this = this;

  async.waterfall([
    //initalizie the db driver
    function(callback)
    {
      _this.db = new _this.db_module.database(_this.dbSettings);
      _this.db.init(callback);
    },
    //initalize the db wrapper
    function(callback)
    {
      _this.db = new dbWrapper.database(_this.db, _this.wrapperSettings);
      _this.db.init(callback);
    } 
  ],callback);
}

/**
 Wrapper functions
*/

exports.database.prototype.get = function (key, callback)
{
  this.db.get(key, callback);
}

exports.database.prototype.set = function (key, value, callback)
{
  this.db.set(key, value, callback);
}

exports.database.prototype.remove = function (key, callback)
{
  this.db.remove(key, callback);
}

exports.database.prototype.close = function(callback)
{
  this.db.close(callback);
}
