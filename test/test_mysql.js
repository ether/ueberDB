'use strict';

const assert = require('assert').strict;
const {databases} = require('./lib/databases');
const mysql = require('../databases/mysql_db');

describe(__filename, function () {
  beforeEach(async function () {
    if (databases.mysql == null) return this.skip();
  });

  it('connect error is detected during init()', async function () {
    // Use an invalid TCP port to force a connection error.
    const db = new mysql.Database({...databases.mysql, port: 65536});
    await assert.rejects(db.init());
  });

  it('reconnect after fatal error', async function () {
    const db = new mysql.Database(databases.mysql);
    await db.init();
    const before = await db._connection;
    // Sleep longer than the timeout to force a fatal error.
    await assert.rejects(db._query({sql: 'DO SLEEP(1);', timeout: 1}), {fatal: true});
    const after = await db._connection;
    assert.notEqual(after, before);
    await db.close();
  });
});
