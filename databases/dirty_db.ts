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

import AbstractDatabase, {Settings} from '../lib/AbstractDatabase';
import Dirty from 'dirty-ts';

type DirtyDBCallback = (p?:any, keys?: string[])=>{};


export const Database = class extends AbstractDatabase {
  private db: any;
  constructor(settings:Settings) {
    super();
    this.db = null;

    if (!settings || !settings.filename) {
      // @ts-ignore
      settings = {filename: null};
    }

    this.settings = settings;

    // set default settings
    this.settings.cache = 0;
    this.settings.writeInterval = 0;
    this.settings.json = false;
  }

  init(callback: ()=>{}) {
    this.db = new Dirty(this.settings.filename);
    this.db.on('load', () => {
      callback();
    });
  }

  get(key:string, callback:DirtyDBCallback) {
    callback(null, this.db.get(key));
  }

  findKeys(key:string, notKey:string, callback:DirtyDBCallback) {
    const keys:string[] = [];
    const regex = this.createFindRegex(key, notKey);
    this.db.forEach((key:string) => {
      if (key.search(regex) !== -1) {
        keys.push(key);
      }
    });
    callback(null, keys);
  }

  set(key:string, value:string, callback:DirtyDBCallback) {
    this.db.set(key, value, callback);
  }

  remove(key:string, callback:DirtyDBCallback) {
    this.db.rm(key, callback);
  }

  close(callback:DirtyDBCallback) {
    this.db.close();
    this.db = null;
    if (callback) callback();
  }
};
