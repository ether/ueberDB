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

import AbstractDatabase, {Settings} from '../lib/AbstractDatabase';
import http, {Agent} from 'http';
import nano from 'nano';
import {BulkObject} from './cassandra_db';

type CouchDBSettings = {
    url: string,
    requestDefaults: {
      auth?: {
        username: string,
        password: string,
      },
      agent: Agent
    }
};
export const Database = class Couch_db extends AbstractDatabase {
  private agent: Agent | null;
  private db: nano.DocumentScope<string> | null;
  constructor(settings: Settings) {
    super();
    this.agent = null;
    this.db = null;
    this.settings = settings;

    // force some settings
    // used by CacheAndBufferLayer.js
    this.settings.cache = 1000;
    this.settings.writeInterval = 100;
    this.settings.json = false;
  }

  get isAsync() { return true; }

  async init() {
    this.agent = new http.Agent({
      keepAlive: true,
      maxSockets: this.settings.maxListeners || 1,
    });

    const coudhDBSettings: CouchDBSettings = {
      url: `http://${this.settings.host}:${this.settings.port}`,
      requestDefaults: {
        agent: this.agent,
      },
    };

    if (this.settings.user && this.settings.password) {
      coudhDBSettings.requestDefaults.auth = {
        username: this.settings.user,
        password: this.settings.password,
      };
    }


    const client = nano(coudhDBSettings);
    try {
      if (this.settings.database != null) {
        await client.db.get(this.settings.database);
      }
    } catch (err: any) {
      if (err.statusCode !== 404) throw err;
      if (this.settings.database != null) {
        await client.db.create(this.settings.database);
      }
    }
    if (this.settings.database != null) {
      this.db = client.use(this.settings.database);
    }
  }

  async get(key:string): Promise<null | string> {
    let doc;
    try {
      if (this.db) {
        doc = await this.db.get(key);
      }
    } catch (err:any) {
      if (err.statusCode === 404) return null;
      throw err;
    }
    if (doc && 'value' in doc) {
      return doc.value as string;
    }
    return '';
  }

  async findKeys(key:string, notKey:string) {
    const pfxLen = key.indexOf('*');
    if (!this.db) {
      return;
    }
    const pfx = pfxLen < 0 ? key : key.slice(0, pfxLen);
    const results = await this.db.find({
      selector: {
        _id: pfxLen < 0 ? pfx : {
          $gte: pfx,
          // https://docs.couchdb.org/en/3.2.2/ddocs/views/collation.html#string-ranges
          $lte: `${pfx}\ufff0`,
          $regex: this.createFindRegex(key, notKey).source,
        },
      },
      fields: ['_id'],
    });
    return results.docs.map((doc) => doc._id);
  }

  async set(key:string, value:string) {
    let doc;

    if (!this.db) {
      return;
    }

    try {
      doc = await this.db.get(key);
    } catch (err:any) {
      if (err.statusCode !== 404) throw err;
    }
    await this.db.insert({
      _id: key,
      // @ts-ignore
      value,
      ...doc == null ? {} : {
        _rev: doc._rev,
      },
    });
  }

  async remove(key:string) {
    let header;
    if (!this.db) {
      return;
    }
    try {
      header = await this.db.head(key);
    } catch (err:any) {
      if (err.statusCode === 404) return;
      throw err;
    }
    // etag has additional quotation marks, remove them
    const etag = JSON.parse(header.etag);
    await this.db.destroy(key, etag);
  }

  async doBulk(bulk:BulkObject[]) {
    if (!this.db) {
      return;
    }
    const keys = bulk.map((op) => op.key);
    const revs:{[key:string]:any} = {};
    // @ts-ignore
    for (const {key, value} of (await this.db.fetchRevs({keys})).rows) {
      // couchDB will return error instead of value if key does not exist
      if (value != null) revs[key] = value.rev;
    }
    const setters = [];
    for (const item of bulk) {
      const set = {_id: item.key, _rev: undefined,
        _deleted: false, value: ''};
      if (revs[item.key] != null) set._rev = revs[item.key];
      if (item.type === 'set') set.value = item.value as string;
      if (item.type === 'remove') set._deleted = true;
      setters.push(set);
    }
    await this.db && await this.db.bulk({docs: setters});
  }

  async close() {
    this.db = null;
    if (this.agent) this.agent.destroy();
    this.agent = null;
  }
};
