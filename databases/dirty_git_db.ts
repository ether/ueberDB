import AbstractDatabase, {Settings} from '../lib/AbstractDatabase';
import {dirname} from 'node:path'
import {simpleGit} from 'simple-git'
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

import {Dirty} from 'rusty-store-kv'
import {convertToDynamicType} from "../lib/utils";

export default class extends AbstractDatabase {
  public db: Dirty;
  constructor(settings: Settings) {
    super(settings);
    // @ts-ignore
    this.db = null;

    if (!settings || !settings.filename) {
      settings = {};
    }

    this.settings = settings;

    // set default settings
    this.settings.cache = 0;
    this.settings.writeInterval = 0;
    this.settings.json = false;
  }

  init(callback: ()=>void) {
    this.db = new Dirty(this.settings.filename!);
    callback()
  }

  get(key:string, callback:Function) {
    const getVal = this.db!.get(key)

    if (getVal === null) {
      return callback(null, null)
    } else {
      callback(null, convertToDynamicType(getVal));
    }
  }

  findKeys(key:string, notKey:string, callback:(v:any, keys:string[])=>{}) {
    const keys = this.db.findKeys(key, notKey)
    callback(null, keys);
  }

  set(key:string, value: string, callback: ()=>{}) {
    this.db.set(key, value);
    const databasePath = dirname(this.settings.filename!);
    simpleGit(databasePath)
        .silent(true)
        .add('./*.db')
        .commit('Automated commit...')
        .push(['-u', 'origin', 'master'], () => console.debug('Stored git commit'));
    if (callback) {
      callback()
    }
  }

  remove(key:string, callback:()=> {}) {
    this.db.remove(key);
    callback()
  }

  close(callback: ()=>void) {
    this.db.close();
    if (callback) callback();
  }
};
