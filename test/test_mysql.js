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
    // An error is expected; prevent it from being logged.
    db.logger = Object.setPrototypeOf({error() {}}, db.logger);
    await assert.rejects(db.init());
  });

  it('query after fatal error works', async function () {
    const db = new mysql.Database(databases.mysql);
    await db.init();
    // An error is expected; prevent it from being logged.
    db.logger = Object.setPrototypeOf({error() {}}, db.logger);
    // Sleep longer than the timeout to force a fatal error.
    await assert.rejects(db._query({sql: 'DO SLEEP(1);', timeout: 1}), {fatal: true});
    await assert.doesNotReject(db._query({sql: 'SELECT 1;'}));
    await db.close();
  });

  it('query times out', async function () {
    const db = new mysql.Database(databases.mysql);
    await db.init();
    // Timeout error messages are expected; prevent them from being logged.
    db.logger = Object.setPrototypeOf({error() {}}, db.logger);
    db.settings.queryTimeout = 100;
    await assert.doesNotReject(db._query({sql: 'DO SLEEP(0.090);'}));
    await assert.rejects(db._query({sql: 'DO SLEEP(0.110);'}));
    await db.close();
  });

  it('queries run concurrently and are queued when pool is busy', async function () {
    const connectionLimit = 10;
    const db = new mysql.Database({...databases.mysql, connectionLimit});
    await db.init();
    // Set the query duration high enough to avoid flakiness on slow machines but low enough to keep
    // the overall test duration short.
    const queryDuration = 100;
    db.settings.queryTimeout = queryDuration + 100;
    const enqueueQuery = () => db._query({sql: `DO SLEEP(${queryDuration / 1000});`});

    // Reduce test flakiness by using slow queries to warm up the pool's connections.
    await Promise.all([...Array(connectionLimit)].map(enqueueQuery));

    // Time how long it takes to run just under 2 * connectionLimit queries.
    const nQueries = 2 * connectionLimit - 1;
    const start = Date.now();
    await Promise.all([...Array(nQueries)].map(enqueueQuery));
    const duration = Date.now() - start;

    const wantDurationLower = Math.ceil(nQueries / connectionLimit) * queryDuration;
    assert(duration >= wantDurationLower, `took ${duration}ms, want >= ${wantDurationLower}ms`);
    const wantDurationUpper = wantDurationLower + queryDuration;
    assert(duration < wantDurationUpper, `took ${duration}ms, want < ${wantDurationUpper}ms`);

    await db.close();
  });
});
