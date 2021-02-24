'use strict';
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

/*
*
* Fair warning that length may not provide the correct value upon load.
* See https://github.com/ether/etherpad-lite/pull/3984
*
*/

const Dirty = require('dirty');

exports.Database = function (settings) {
  this.db = null;

  if (!settings || !settings.filename) {
    settings = {filename: null};
  }

  this.settings = settings;

  // set default settings
  this.settings.cache = 0;
  this.settings.writeInterval = 0;
  this.settings.json = false;
};

exports.Database.prototype.init = function (callback) {
  this.db = new Dirty(this.settings.filename);
  this.db.on('load', (err) => {
    callback();
  });
};

exports.Database.prototype.get = function (key, callback) {
  callback(null, this.db.get(key));
};

exports.Database.prototype.findKeys = function (key, notKey, callback) {
  const keys = [];
  const regex = this.createFindRegex(key, notKey);
  this.db.forEach((key, val) => {
    if (key.search(regex) !== -1) {
      keys.push(key);
    }
  });
  callback(null, keys);
};

exports.Database.prototype.set = function (key, value, callback) {
  this.db.set(key, value, callback);
};

exports.Database.prototype.remove = function (key, callback) {
  this.db.rm(key, callback);
};

exports.Database.prototype.close = function (callback) {
  // Sleep a bit before closing to work around https://github.com/ether/etherpad-lite/issues/4684.
  setTimeout(() => {
    this.db.close();
    if (callback) callback();
  }, 500);
};
