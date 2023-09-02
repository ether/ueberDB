/**
 * 2023 Samuel Schwanzer
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
import Surreal from 'surrealdb.js';
import {BulkObject} from "./cassandra_db";

const DATABASE = 'ueberdb';
const STORE_WITH_DOT = 'store:';
const STORE = 'store';
const simpleGlobToRegExp = (s:string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');

type StoreVal = {
    id: string;
    key: string;
    value: string;
}
export const Database = class SurrealDB extends AbstractDatabase {
    private _client: Surreal | null;
    constructor(settings:Settings) {
        super();
        this._client = null;
        this.settings = settings || {};
    }

    get isAsync() { return true; }

    async init() {
        if (this.settings.url) {
            this._client = new Surreal(this.settings.url);
        } else if (this.settings.host) {
            this._client = new Surreal(this.settings.host);
        }
        if(this.settings.user && this.settings.password) {
            await this._client!.signin({
                user: this.settings.user!,
                pass: this.settings.password!
            })
        }
        await this._client!.use({ns:DATABASE, db:DATABASE});
    }

    async get(key:string) {
        if (this._client == null) return null;
        const res = await this._client.select<StoreVal>(STORE_WITH_DOT+key)
        if(res.length>0){
            return res[0].value
        }
        else{
            return null;
        }
    }

    async findKeys(key:string, notKey:string) {
        if (this._client == null) return null;
        /*
        let query = "SELECT key FROM store WHERE key CONTAINS $key"
        if (notKey != null) {
            query += " AND key CONTAINSNOT $notKey"

            const keys = await this._client.query<StoreVal[]>(query, {key, notKey})
            const value: string[] = [];
            keys.forEach(k=>{
                value.push(k.result!.id);
            })
            return value
        }

        const keys = await this._client.query<StoreVal[]>(query, {key})
        const value: string[] = [];
        keys.forEach(k=>{
            value.push(k.result!.id);
        })
        return value
         */
        console.log("findKeys with ", key)
        let res = await this._client.select<StoreVal>(STORE)
        console.log("stored entries",res)
        const keys:string[] = [];
        const regex = this.createFindRegex(key, notKey);
        res.forEach((key) => {
            if (key.key.search(regex) !== -1) {
                keys.push(key.key);
            }
        });
        return keys
    }

    /**
     * For findKey regex. Used by document dbs like mongodb or dirty.
     */
    createFindRegex(key:string, notKey?:string) {
        let regex = `^(?=${simpleGlobToRegExp(key)}$)`;
        if (notKey != null) regex += `(?!${simpleGlobToRegExp(notKey)}$)`;
        return new RegExp(regex);
    }

    async set(key:string, value:string) {
        if (this._client == null) return null;
        const exists = await this.get(key)
        if(exists){
           await this._client.update<StoreVal>(STORE, {
                id:  key,
                key: key,
                value: value
            })
        }
        else {
                const res = await this._client.create<StoreVal>(STORE, {
                    id: key,
                    key:key,
                    value: value
                })
            }
    }

    async remove(key:string) {
        if (this._client == null) return null
        return await this._client.delete<StoreVal>(STORE_WITH_DOT+key)
    }

    async doBulk(bulk: BulkObject[]) {
        if (this._client == null) return null;

        bulk.forEach(b=>{
            if (b.type === 'set') {
                this._client!.update(STORE+b.key, {key: b.key, value: b.value});
            } else if (b.type === 'remove') {
                this._client!.delete(STORE+b.key);
            }
        })
    }

    async close() {
        if (this._client == null) return null;
        await this._client.close();
        this._client = null;
    }
};
