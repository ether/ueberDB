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
import {QueryResult} from "surrealdb.js/script/types";
const DATABASE = 'ueberdb';

const WILDCARD= '*';

type StoreVal = {
    key: string;
    value: string;
    raw: string;
}

const replaceAt = function(index:number, replacement:string, original:string) {
    return original.substring(0, index) + replacement + original.substring(index + replacement.length);
}
const escapeKey = (key:string)=>{
    const index = key.indexOf(':')
    if (index>-1){
        return replaceAt(index, "_", key)
    }
    return key
}

const unescapeKey = (key:string, originalKey:string)=>{
    const index = originalKey.indexOf(':')
    if(index>-1){
        return replaceAt(index, ":", key)
    }
    return key
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
            const port = this.settings.port || 8000;
            const protocol = this.settings.clientOptions.protocol || 'http://';
            const path = this.settings.clientOptions.path || '/rpc';
            const host = this.settings.host;
            this._client = new Surreal(protocol+host+':'+port+path);
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
        key = escapeKey(key)
        const res = await this._client.query( "SELECT key,value FROM store WHERE key= $key", {key}) as QueryResult<StoreVal[]>[]
        if(res[0].result!.length>0){
            return res[0].result![0].value
        }
        else{
            return null;
        }
    }

    async findKeys(key:string, notKey:string) {
        if (this._client == null) return null;

        if (notKey != null){
            const query  = `SELECT key FROM store WHERE ${this.transformWildcard(key, 'key')} AND ${this.transformWildcardNegative(notKey, 'notKey')}`
            notKey = notKey.replace(WILDCARD, '')
            key = key.replace(WILDCARD, '')
            const res = await this._client.query<StoreVal[]>(query, {key:key, notKey:notKey})  as QueryResult<StoreVal[]>[]
            return this.transformResult(res,key)
        }
        else{
            const query  = `SELECT key FROM store WHERE ${this.transformWildcard(key, 'key')}`
            key = key.replace(WILDCARD, '')
            const res = await this._client.query<StoreVal[]>(query, {key}) as QueryResult<StoreVal[]>[]
            return this.transformResult(res, key)
        }
    }

    transformWildcard(key: string, keyExpr: string){
        if (key.startsWith(WILDCARD) && key.endsWith(WILDCARD)) {
            return `${keyExpr} CONTAINS $${keyExpr}`
        }
        else if (key.startsWith(WILDCARD)) {
            return `string::endsWith(${keyExpr}, $${keyExpr})`
        }
        else if (key.endsWith(WILDCARD)) {
            return `string::startsWith(${keyExpr}, $${keyExpr})`
        }
        else {
            return `${keyExpr} = $${keyExpr}`
        }
    }

    transformWildcardNegative(key: string, keyExpr: string){
        if (key.startsWith(WILDCARD) && key.endsWith(WILDCARD)) {
            return `key CONTAINSNOT $${keyExpr}`
        }
        else if (key.startsWith(WILDCARD)) {
            return `string::endsWith(key, $${keyExpr})==false`
        }
        else if (key.endsWith(WILDCARD)) {
            return `string::startsWith(key, $${keyExpr})==false`
        }
        else {
            return `key != $${keyExpr}`
        }
    }

    transformResult(res: QueryResult<StoreVal[]>[], originalKey:string){
        const value: string[] = [];
        res[0].result!.forEach(k=>{
            value.push(unescapeKey(k.key, originalKey));
        })
        return value
    }

    async set(key:string, value:string) {
        if (this._client == null) return null;
        const exists = await this.get(key)
        if(exists){
            key = escapeKey(key)
            await this._client.query("UPDATE store SET value = $value WHERE key = $key", {key, value})
        }
        else {
            key = escapeKey(key)
            await this._client.query("INSERT INTO store (key, value) VALUES ($key, $value)", {key, value})
        }
    }

    async remove(key:string) {
        if (this._client == null) return null
        key = escapeKey(key)
        return await this._client.query("DELETE FROM store WHERE key = $key", {key})
    }

    async doBulk(bulk: BulkObject[]) {
        if (this._client == null) return null;

        bulk.forEach(b=>{
            if (b.type === 'set') {
                this.set(b.key, b.value!)
            } else if (b.type === 'remove') {
                this.remove(b.key);
            }
        })
    }

    async close() {
        if (this._client == null) return null;
        await this._client.close();
        this._client = null;
    }
};
