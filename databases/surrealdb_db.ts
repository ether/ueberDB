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
import {Surreal} from 'surrealdb';
import {BulkObject} from "./cassandra_db";

const DATABASE = 'ueberdb';
const WILDCARD = '*';

type StoreVal = {
    key: string;
    value: string;
};

const replaceAt = function(index: number, replacement: string, original: string) {
    return original.substring(0, index) + replacement + original.substring(index + replacement.length);
};

// surrealdb uses `:` to separate the table name from the record id; an
// untreated `:` in a key would create an unintended record id, so we replace
// the first `:` with `_` on write and reverse the substitution on read.
const escapeKey = (key: string) => {
    const index = key.indexOf(':');
    if (index > -1) {
        return replaceAt(index, '_', key);
    }
    return key;
};

const unescapeKey = (key: string, originalKey: string) => {
    const index = originalKey.indexOf(':');
    if (index > -1) {
        return replaceAt(index, ':', key);
    }
    return key;
};

export default class SurrealDB extends AbstractDatabase {
    public _client: Surreal | null;

    constructor(settings: Settings) {
        super(settings);
        this._client = null;
    }

    get isAsync() { return true; }

    async init() {
        if (this.settings.url) {
            this._client = new Surreal();
            await this._client.connect(this.settings.url);
        } else if (this.settings.host) {
            const port = this.settings.port || 8000;
            const protocol = this.settings.clientOptions?.protocol || 'http://';
            const path = this.settings.clientOptions?.path || '/rpc';
            const host = this.settings.host;
            this._client = new Surreal();
            await this._client.connect(`${protocol}${host}:${port}${path}`);
        }
        if (this.settings.user && this.settings.password) {
            await this._client!.signin({
                username: this.settings.user!,
                password: this.settings.password!,
            });
        }
        await this._client!.use({namespace: DATABASE, database: DATABASE});
    }

    async get(key: string): Promise<string | null> {
        if (this._client == null) return null;

        key = escapeKey(key);
        // surrealdb 2.x: query() returns a Query<R> that resolves to an
        // array of result sets — one entry per SurrealQL statement. The
        // first entry is the rows for our SELECT.
        const res = await this._client.query<[StoreVal[]]>(
            'SELECT key, value FROM store WHERE key = $key',
            {key},
        );
        const rows = res[0] || [];
        if (rows.length === 0) return null;
        const row = rows[0];
        if (typeof row === 'string') return row;
        return unescapeKey(row.value, key);
    }

    async findKeys(key: string, notKey: string | null) {
        if (this._client == null) return null;

        const queryString = notKey != null
            ? `SELECT key FROM store WHERE ${this.transformWildcard(key, 'key')} AND ${this.transformWildcardNegative(notKey, 'notKey')}`
            : `SELECT key FROM store WHERE ${this.transformWildcard(key, 'key')}`;

        const cleanKey = key.replace(WILDCARD, '');
        const cleanNotKey = (notKey || '').replace(WILDCARD, '');
        const bindings: Record<string, unknown> = {key: cleanKey};
        if (notKey != null) bindings.notKey = cleanNotKey;

        const res = await this._client.query<[StoreVal[]]>(queryString, bindings);
        return this.transformResult(res[0] || [], cleanKey);
    }

    transformWildcard(key: string, keyExpr: string) {
        if (key.startsWith(WILDCARD) && key.endsWith(WILDCARD)) {
            return `${keyExpr} CONTAINS $${keyExpr}`;
        } else if (key.startsWith(WILDCARD)) {
            return `string::endsWith(${keyExpr}, $${keyExpr})`;
        } else if (key.endsWith(WILDCARD)) {
            return `string::startsWith(${keyExpr}, $${keyExpr})`;
        } else {
            return `${keyExpr} = $${keyExpr}`;
        }
    }

    transformWildcardNegative(key: string, keyExpr: string) {
        if (key.startsWith(WILDCARD) && key.endsWith(WILDCARD)) {
            return `key CONTAINSNOT $${keyExpr}`;
        } else if (key.startsWith(WILDCARD)) {
            return `string::endsWith(key, $${keyExpr}) == false`;
        } else if (key.endsWith(WILDCARD)) {
            return `string::startsWith(key, $${keyExpr}) == false`;
        } else {
            return `key != $${keyExpr}`;
        }
    }

    transformResult(rows: StoreVal[] | string, originalKey: string) {
        const value: string[] = [];
        if (typeof rows === 'string') {
            value.push(unescapeKey(rows, originalKey));
            return value;
        }
        for (const row of rows) {
            value.push(unescapeKey(row.key, originalKey));
        }
        return value;
    }

    async set(key: string, value: string) {
        if (this._client == null) return null;
        const exists = await this.get(key);
        const escapedKey = escapeKey(key);
        if (exists) {
            await this._client.query(
                'UPDATE store SET value = $value WHERE key = $key',
                {key: escapedKey, value},
            );
        } else {
            await this._client.query(
                'INSERT INTO store (key, value) VALUES ($key, $value)',
                {key: escapedKey, value},
            );
        }
    }

    async remove(key: string) {
        if (this._client == null) return null;
        key = escapeKey(key);
        return await this._client.query(
            'DELETE FROM store WHERE key = $key',
            {key},
        );
    }

    async doBulk(bulk: BulkObject[]) {
        if (this._client == null) return null;
        for (const b of bulk) {
            if (b.type === 'set') {
                await this.set(b.key, b.value!);
            } else if (b.type === 'remove') {
                await this.remove(b.key);
            }
        }
    }

    async close() {
        if (this._client == null) return null;
        await this._client.close();
        this._client = null;
    }
}
