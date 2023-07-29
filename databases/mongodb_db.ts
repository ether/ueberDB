/**
 * 2020 Sylchauf
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

import {BulkObject} from './cassandra_db';
import {Collection, Db, MongoClient} from 'mongodb';

export const Database = class extends AbstractDatabase {
  private interval: NodeJS.Timer | undefined;
  private database:  Db|undefined;
  private client: MongoClient|undefined;
  private collection:  Collection|undefined;
  constructor(settings:Settings) {
    super();
    this.settings = settings;

    if (!this.settings.url) throw new Error('You must specify a mongodb url');
    // For backwards compatibility:
    if (this.settings.database == null) this.settings.database = this.settings.dbName;

    if (!this.settings.collection) this.settings.collection = 'ueberdb';
  }

  clearPing() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  schedulePing() {
    this.clearPing();
    this.interval = setInterval(() => {
      this.database!.command({
        ping: 1,
      });
    }, 10000);
  }

  init(callback:Function) {

    MongoClient.connect(this.settings.url!).then((v)=>{
        this.client = v;
        this.database = v.db(this.settings.database);
        this.collection = this.database.collection(this.settings.collection!);
        callback(null);
    })
        .catch((v:Error)=>{
            callback(v);
        })

    this.schedulePing();
  }

  get(key:string, callback:Function) {
    // @ts-ignore
    this.collection!.findOne({_id: key})
        .then((v)=>{
          callback(null, v&&v.value);
    }).catch(v=> {
      console.log(v)
      callback(v);
    })

    this.schedulePing();
  }

  findKeys(key:string, notKey:string, callback:Function) {
    const selector = {
      $and: [
        {_id: {$regex: `${key.replace(/\*/g, '')}`}},
      ],
    };

    if (notKey) {
      // @ts-ignore
      selector.$and.push({_id: {$not: {$regex: `${notKey.replace(/\*/g, '')}`}}});
    }

    // @ts-ignore
    this.collection!.find(selector).map((i: any) => i._id)
        .toArray()
        .then(r =>{
        callback(null, r);
    })
        .catch(v=>callback(v));


    this.schedulePing();
  }

  set(key:string, value:string, callback:Function) {
    if (key.length > 100) {
      callback('Your Key can only be 100 chars');
    } else {
      // @ts-ignore
      this.collection!.updateMany({_id: key}, {$set: {value}}, {upsert: true})
          .then(()=>callback(null))
          .catch(v=>callback(v));
    }

    this.schedulePing();
  }

  remove(key:string, callback:Function) {
    // @ts-ignore
    this.collection!.deleteOne({_id: key}, )
        .then(r =>callback(null,r) )
        .catch(v=>callback(v));

    this.schedulePing();
  }

  doBulk(bulk:BulkObject[], callback:Function) {
    const bulkMongo = this.collection!.initializeOrderedBulkOp();

    for (const i in bulk) {
      if (bulk[i].type === 'set') {
        bulkMongo.find({_id: bulk[i].key}).upsert().updateOne({$set: {value: bulk[i].value}});
      } else if (bulk[i].type === 'remove') {
        bulkMongo.find({_id: bulk[i].key}).deleteOne();
      }
    }

    bulkMongo.execute().then((res:any) => {
      callback(null, res);
    }).catch((error:any) => {
      callback(error);
    });

    this.schedulePing();
  }

  close(callback:any) {
    this.clearPing();
    this.client!.close().then(r =>callback(r));
  }
}
