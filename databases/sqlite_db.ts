'use strict';
import {BulkObject} from "./cassandra_db";
import AbstractDatabase, {Settings} from "../lib/AbstractDatabase";
import {SQLite} from 'rusty-store-kv'

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

const escape = (val:string) => `'${val.replace(/'/g, "''")}'`;

type RequestVal = {
  value: string;
}

export default class SQLiteDB extends AbstractDatabase {
  public db: SQLite|null;
  constructor(settings:Settings) {
    super(settings);
    this.db = null;

    if (!settings || !settings.filename) {
      settings = {filename: ':memory:'};
    }

    this.settings = settings;

    // set settings for the dbWrapper
    if (settings.filename === ':memory:') {
      this.settings.cache = 0;
      this.settings.writeInterval = 0;
      this.settings.json = true;
    } else {
      this.settings.cache = 1000;
      this.settings.writeInterval = 100;
      this.settings.json = true;
    }
  }

  init(callback: Function) {
    this.db = new SQLite(this.settings.filename as string)
    callback();
  }


  get(key:string, callback:Function) {
    const res = this.db!.get(key)
    callback(null, res ? res : null)
  }

  findKeys(key:string, notKey:string, callback:Function) {
    let res;

    if (notKey === null) {
      res = this.db!.findKeys(key, notKey)
    } else {
      res = this.db?.findKeys(key)
    }

    callback(null, res);
  }

  set(key:string, value:string, callback:Function) {
    const res = this.db!.set(key, value)
    res ? callback(null, null) : callback(null, res)
  }

  remove(key:string, callback:Function) {
    this.db!.remove(key)
    callback(null, null)
  }


  doBulk(bulk:BulkObject[], callback:Function) {
    const convertedBulk = bulk.map(b=>{
      if (b.value === null) {
        return {
          key: b.key,
          type: b.type
        } satisfies BulkObject
      } else {
        return b
      }
    })

    this.db!.doBulk(convertedBulk)
    callback();
  }

  close(callback: Function) {
    callback()
    this.db!.close();
  }
};
