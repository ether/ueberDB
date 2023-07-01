import AbstractDatabase, {Settings} from '../lib/AbstractDatabase';

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


// @ts-ignore
import {Dirty} from 'dirty';

export const Database = class extends AbstractDatabase {
  private db: any;
  constructor(settings: Settings) {
    super();
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
    this.db = new Dirty(this.settings.filename);
    this.db.on('load', (err: Error) => {
      callback();
    });
  }

  get(key:string, callback: (err: string | any, value: string)=>void) {
    callback(null, this.db.get(key));
  }

  findKeys(key:string, notKey:string, callback:(v:any, keys:string[])=>{}) {
    const keys:string[] = [];
    const regex = this.createFindRegex(key, notKey);
    this.db.forEach((key:string, val:string) => {
      if (key.search(regex) !== -1) {
        keys.push(key);
      }
    });
    callback(null, keys);
  }

  set(key:string, value: string, callback: ()=>{}) {
    this.db.set(key, value, callback);
    const databasePath = require('path').dirname(this.settings.filename);
    require('simple-git')(databasePath)
        .silent(true)
        .add('./*.db')
        .commit('Automated commit...')
        .push(['-u', 'origin', 'master'], () => console.debug('Stored git commit'));
  }

  remove(key:string, callback:()=> {}) {
    this.db.rm(key, callback);
  }

  close(callback: ()=>void) {
    this.db.close();
    if (callback) callback();
  }
};
