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
  this.db.get(key, function(err, value)
  {
    value = clone(value);
    callback(err, value);
  });
}

exports.database.prototype.set = function (key, value, callback)
{
  this.db.set(key, clone(value), callback);
}

exports.database.prototype.getSub = function (key, sub, callback)
{
  this.db.getSub(key, sub, function(err, value)
  {
    value = clone(value);
    callback(err, value);
  });
}

exports.database.prototype.setSub = function (key, sub, value, callback)
{
  this.db.setSub(key, sub, clone(value), callback);
}

exports.database.prototype.remove = function (key, callback)
{
  this.db.remove(key, callback);
}

exports.database.prototype.close = function(callback)
{
  this.db.close(callback);
}

function clone(obj)
{
  // Handle the 3 simple types, and null or undefined
  if (null == obj || "object" != typeof obj) return obj;

  // Handle Date
  if (obj instanceof Date)
  {
    var copy = new Date();
    copy.setTime(obj.getTime());
    return copy;
  }

  // Handle Array
  if (obj instanceof Array)
  {
    var copy = [];
    for (var i = 0, len = obj.length; i < len; ++i)
    {
      copy[i] = clone(obj[i]);
    }
    return copy;
  }

  // Handle Object
  if (obj instanceof Object)
  {
    var copy = {};
    for (var attr in obj)
    {
      if (obj.hasOwnProperty(attr)) copy[attr] = clone(obj[attr]);
    }
    return copy;
  }

  throw new Error("Unable to copy obj! Its type isn't supported.");
}
