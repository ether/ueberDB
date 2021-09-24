'use strict';

const assert = require('assert').strict;
const {databases} = require('./lib/databases');
const ueberdb = require('../index');
const util = require('util');

describe(__filename, function () {
  it('connection string instead of settings object', async function () {
    const {user, password, host, database} = databases.postgres;
    const db =
        new ueberdb.Database('postgres', `postgres://${user}:${password}@${host}/${database}`);
    await util.promisify(db.init.bind(db))();
    await util.promisify(db.set.bind(db))('key', 'val');
    assert.equal(await util.promisify(db.get.bind(db))('key'), 'val');
  });
});
