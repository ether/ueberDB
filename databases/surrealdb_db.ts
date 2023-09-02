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
const STORE_WITH_DOT = 'store:';
const STORE = 'store';

const WILDCARD= '*';
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

        if (notKey != null){
            const query  = `SELECT key FROM store WHERE ${this.transformWildcard(key, 'key')} AND ${this.transformWildcardNegative(notKey, 'notKey')}`
            key = key.replace(WILDCARD, '')
            notKey = notKey.replace(WILDCARD, '')
            console.log("Key ",key, " notKey ", notKey)
            const res = await this._client.query<StoreVal[]>(query, {key:key, notKey:notKey})
            // @ts-ignore
            return this.transformResult(res)
        }
        else{
            const query  = `SELECT key FROM store WHERE ${this.transformWildcard(key, 'key')}`
            key = key.replace(WILDCARD, '')
            const res = await this._client.query<StoreVal[]>(query, {key})
            // @ts-ignore
            return this.transformResult(res)
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

    transformResult(res: QueryResult<StoreVal[]>[]){
        const value: string[] = [];
        console.log("Outer result ", res)
        res[0].result!.forEach(k=>{
            console.log("Resultat ",k)
            value.push(k.key);
        })
        return value
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
           const updatE = await this._client.update<StoreVal>(STORE, {
                id:  key,
                key: key,
                value: value
            })
            console.log("Update ", updatE)
        }
        else {
                const created  = await this._client.create<StoreVal>(STORE, {
                    id: key,
                    key:key,
                    value: value
                })
                console.log("Created ", created)
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
