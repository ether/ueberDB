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

import AbstractDatabase, {Settings} from '../lib/AbstractDatabase';
import {createClient,  RedisClientOptions} from 'redis';
import {BulkObject} from './cassandra_db';

export default class RedisDB extends AbstractDatabase {
  public _client: any
  constructor(settings:Settings) {
    super(settings);
    this._client = null;
    this.settings = settings || {};
  }

  get isAsync() { return true; }

  async init() {
    if (this.settings.url) {
      this._client = createClient({url: this.settings.url});
    } else if (this.settings.host) {
      const options:RedisClientOptions = {
        socket:{
          host: this.settings.host,
          port: Number(this.settings.port),
        }
      }
      if (this.settings.password){
        options.password = this.settings.password;
      }
      if (this.settings.user){
        options.username = this.settings.user;
      }
      this._client = createClient(options)
    }
    if (this._client) {
      await this._client.connect();
      await this._client.ping();
    }
  }

  async get(key:string) {
    if (this._client == null) return null;
    return await this._client.get(key);
  }

  async findKeys(key:string, notKey:string) {
    if (this._client == null) return null;
    const [_, type] = /^([^:*]+):\*$/.exec(key) || [];
    if (type != null && ['*:*:*', `${key}:*`].includes(notKey)) {
      // Performance optimization for a common Etherpad case.
      return await this._client.sMembers(`ueberDB:keys:${type}`);
    }
    let keys = await this._client.keys(key.replace(/[?[\]\\]/g, '\\$&'));
    if (notKey != null) {
      const regex = this.createFindRegex(key, notKey);
      keys = keys.filter((k:string) => regex.test(k));
    }
    return keys;
  }

  async set(key:string, value:string) {
    if (this._client == null) return null;
    const matches = /^([^:]+):([^:]+)$/.exec(key);
    await Promise.all([
      matches && this._client.sAdd(`ueberDB:keys:${matches[1]}`, matches[0]),
      this._client.set(key, value),
    ]);
  }

  async remove(key:string) {
    if (this._client == null) return null;
    const matches = /^([^:]+):([^:]+)$/.exec(key);
    await Promise.all([
      matches && this._client.sRem(`ueberDB:keys:${matches[1]}`, matches[0]),
      this._client.del(key),
    ]);
  }

  async doBulk(bulk: BulkObject[]) {
    if (this._client == null) return null;
    const multi = this._client.multi();

    for (const {key, type, value} of bulk) {
      const matches = /^([^:]+):([^:]+)$/.exec(key);
      if (type === 'set') {
        if (matches) {
          multi.sAdd(`ueberDB:keys:${matches[1]}`, matches[0]);
        }
        multi.set(key, value as string);
      } else if (type === 'remove') {
        if (matches) {
          multi.sRem(`ueberDB:keys:${matches[1]}`, matches[0]);
        }
        multi.del(key);
      }
    }

    await multi.exec();
  }

  async close() {
    if (this._client == null) return null;
    await this._client.quit();
    this._client = null;
  }
};
