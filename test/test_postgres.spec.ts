import {databases} from './lib/databases';
import * as ueberdb from '../index';
'use strict';
import {equal} from 'assert';
import {describe, it} from 'vitest'

describe(__filename, () => {
  it('connection string instead of settings object', async () => {
    const {user, password, host, database} = databases.postgres;
    console.log(`postgres://${user}:${password}@${host}/${database}`);
    const db = new ueberdb.Database('postgres', `postgres://${user}:${password}@${host}/${database}`);
    await db.init();
    await db.set('key', 'val');
    const val = await db.get('key') as string;
    equal(val, 'val');
  });
});
