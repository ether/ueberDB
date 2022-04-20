'use strict';

const assert = require('assert').strict;
const {databases} = require('./lib/databases');
const ueberdb = require('../index');

describe(__filename, function () {
  it('connection string instead of settings object', async function () {
    const {user, password, host, database} = databases.postgres;
    const db =
        new ueberdb.Database('postgres', `postgres://${user}:${password}@${host}/${database}`);
    await db.init();
    await db.set('key', 'val');
    assert.equal(await db.get('key'), 'val');
  });
});
