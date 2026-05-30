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

import AbstractDatabase, { type Settings } from "../lib/AbstractDatabase";
import type { BulkObject } from "./cassandra_db";
import { MongoClient } from "mongodb";
import type { Collection, Db, Filter } from "mongodb";

// Document shape stored in the ueberdb collection. _id is the user-provided string key,
// not the default ObjectId, so mongodb's generic types need this narrowing.
type UeberDoc = { _id: string; value: string };

export default class extends AbstractDatabase {
  public database: Db | undefined;
  public client: MongoClient | undefined;
  public collection: Collection<UeberDoc> | undefined;
  constructor(settings: Settings) {
    super(settings);
    this.settings = settings;

    if (!this.settings.url) throw new Error("You must specify a mongodb url");
    // For backwards compatibility:
    if (this.settings.database == null) this.settings.database = this.settings.dbName;

    if (!this.settings.collection) this.settings.collection = "ueberdb";
  }

  init(callback: Function) {
    MongoClient.connect(this.settings.url!)
      .then((v) => {
        this.client = v;
        this.database = v.db(this.settings.database);
        this.collection = this.database.collection<UeberDoc>(this.settings.collection!);
        callback(null);
      })
      .catch((v: Error) => {
        callback(v);
      });
  }

  get(key: string, callback: Function) {
    this.collection!.findOne({ _id: key })
      .then((v) => {
        callback(null, v && v.value);
      })
      .catch((v) => {
        console.log(v);
        callback(v);
      });
  }

  findKeys(key: string, notKey: string, callback: Function) {
    const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const selector: Filter<UeberDoc> = {
      $and: [{ _id: { $regex: `^${escape(key)}$` } }],
    };

    if (notKey) {
      selector.$and!.push({ _id: { $not: { $regex: `^${escape(notKey)}$` } } });
    }

    this.collection!.find(selector)
      .map((i) => i._id)
      .toArray()
      .then((r) => callback(null, r))
      .catch((v) => callback(v));
  }

  set(key: string, value: string, callback: Function) {
    if (key.length > 100) {
      callback("Your Key can only be 100 chars");
    } else {
      this.collection!.updateMany({ _id: key }, { $set: { value } }, { upsert: true })
        .then(() => callback(null))
        .catch((v) => callback(v));
    }
  }

  remove(key: string, callback: Function) {
    this.collection!.deleteOne({ _id: key })
      .then((r) => callback(null, r))
      .catch((v) => callback(v));
  }

  doBulk(bulk: BulkObject[], callback: Function) {
    const bulkMongo = this.collection!.initializeUnorderedBulkOp();

    for (const i in bulk) {
      if (bulk[i].type === "set") {
        bulkMongo
          .find({ _id: bulk[i].key })
          .upsert()
          .updateOne({ $set: { value: bulk[i].value } });
      } else if (bulk[i].type === "remove") {
        bulkMongo.find({ _id: bulk[i].key }).deleteOne();
      }
    }

    bulkMongo
      .execute()
      .then((res: any) => {
        callback(null, res);
      })
      .catch((error: any) => {
        callback(error);
      });
  }

  close(callback: any) {
    this.client!.close().then((r) => callback(r));
  }
}
