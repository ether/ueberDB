'use strict';
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
import {MongoClient,Document} from 'mongodb';
import {BulkObject} from "./cassandra_db";

export const Database = class MongoDB extends AbstractDatabase {
  private interval: NodeJS.Timer | undefined;
  private database: any;
  private client: MongoClient | undefined;
  private collection: any;
  constructor(settings: Settings) {
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
      this.database.command({
        ping: 1,
      });
    }, 10000);
  }

  init(callback: (err: Error)=>{}) {

     MongoClient.connect(this.settings.url as string).then((client) => {
       this.client = client;
       this.database = client.db(this.settings.database);
       this.collection = this.database.collection(this.settings.collection);
     })
         .catch(err=>{
           callback(err);
         })

    this.schedulePing();
  }

  get(key:string, callback: (err:Error|null, document?:Document)=>{}) {
    this.collection.findOne({_id: key}, (err: Error, document:Document) => {
      if (err) callback(err);
      else callback(null, document ? document.value : null);
    });

    this.schedulePing();
  }

  findKeys(key:string, notKey:string, callback:(err:Error|null, keys?:string[])=>{}) {
    const selector = {
      $and: [
        {_id: {$regex: `${key.replace(/\*/g, '')}`}},
      ],
    };

    if (notKey) {
      // @ts-ignore
      selector.$and.push({_id: {$not: {$regex: `${notKey.replace(/\*/g, '')}`}}});
    }

    this.collection.find(selector, async (err:Error, res:any) => {
      if (err) {
        callback(err);
      } else {
        const data = await res.toArray();

        callback(null, data.map((i: { _id: any; }) => i._id));
      }
    });

    this.schedulePing();
  }

  set(key:string, value:string, callback:(val: string)=>{}) {
    if (key.length > 100) {
      callback('Your Key can only be 100 chars');
    } else {
      this.collection.update({_id: key}, {$set: {value}}, {upsert: true}, callback);
    }

    this.schedulePing();
  }

  remove(key:string, callback:(err:Error|null)=>{}) {
    this.collection.remove({_id: key}, callback);

    this.schedulePing();
  }

  doBulk(bulk:BulkObject[], callback:(err: any, res?:any)=>{}) {
    const bulkMongo = this.collection.initializeOrderedBulkOp();

    for (const i in bulk) {
      if (bulk[i].type === 'set') {
        bulkMongo.find({_id: bulk[i].key}).upsert().updateOne({$set: {value: bulk[i].value}});
      } else if (bulk[i].type === 'remove') {
        bulkMongo.find({_id: bulk[i].key}).deleteOne();
      }
    }

    bulkMongo.execute().then((res: any) => {
      callback(null, res);
    }).catch((error: any) => {
      callback(error);
    });

    this.schedulePing();
  }

  close(callback: ()=>{}) {
    this.clearPing();
    this.client&&this.client.close(callback);
  }
};
