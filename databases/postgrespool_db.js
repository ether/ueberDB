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

const pg = require('pg');
const postgresCommon = require('./postgres_common');

exports.Database = class extends postgresCommon.Database {
  constructor(settings) {
    super();
    this.settings = settings;

    this.settings.cache = settings.cache || 1000;
    this.settings.writeInterval = 100;
    this.settings.json = true;

    // Pool specific defaults
    this.settings.max = this.settings.max || 20;
    this.settings.min = this.settings.min || 4;
    this.settings.idleTimeoutMillis = this.settings.idleTimeoutMillis || 1000;

    this.db = new pg.Pool(this.settings);
  }
};
