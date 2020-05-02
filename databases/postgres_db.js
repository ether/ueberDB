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

var pg = require("pg");
var postgresCommon = require('./postgres_common');

exports.database = function(settings)
{
  this.settings = settings;

  this.settings.cache = settings.cache || 1000;
  this.settings.writeInterval = 100;
  this.settings.json = true;

  this.db = new pg.Client(this.settings);
  this.db.connect();
}

exports.database.prototype.init = postgresCommon.init;
exports.database.prototype.get = postgresCommon.get;
exports.database.prototype.findKeys = postgresCommon.findKeys;
exports.database.prototype.set = postgresCommon.set;
exports.database.prototype.remove = postgresCommon.remove;
exports.database.prototype.doBulk = postgresCommon.doBulk;

exports.database.prototype.close = function(callback)
{
  var _this = this;

  this.db.on('drain', function() {
  	_this.db.end.bind(_this.db);
  	callback(null);
  });
}
