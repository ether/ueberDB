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

var couch = require("felix-couchdb");

exports.database = function(settings)
{
  this.db=null;
  this.client=null;
  
  this.settings = settings;
  
  //set default settings
  this.settings.cache = 0;
  this.settings.writeInterval = 0;
  this.settings.json = false;
}

exports.database.prototype.init = function(callback)
{
  this.client = couch.createClient(this.settings.port, this.settings.host, null, null, 0);
  this.db = this.client.db(this.settings.database);
  callback();
}

exports.database.prototype.get = function (key, callback)
{
  this.db.getDoc(key, function(er, doc)
  {
    if(doc == null)
    {
      callback(null, null);
    }
    else
    {
      callback(null, doc.value);
    }
  });
}

exports.database.prototype.set = function (key, value, callback)
{
  this.db.saveDoc({id: key, value: value}, callback);
}

exports.database.prototype.remove = function (key, callback)
{
  var _this = this;
  this.db.getDoc(key, function(er, doc)
  {
    if(doc == null)
    {
      callback(null);
    }
    else
    {
      _this.db.removeDoc(key, doc._rev, function(er,r)
      {
        callback(null);
      });
    }
  });
}

exports.database.prototype.close = function(callback)
{
  if(callback) callback();
}
