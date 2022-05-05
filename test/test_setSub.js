'use strict';

const assert = require('assert').strict;
const ueberdb = require('../index');

describe(__filename, function () {
  let db;

  beforeEach(async function () {
    db = new ueberdb.Database('memory', {}, {});
    await db.init();
  });

  afterEach(async function () {
    if (db != null) await db.close();
    db = null;
  });

  it('setSub rejects __proto__', async function () {
    await db.set('k', {});
    await assert.rejects(db.setSub('k', ['__proto__'], 'v'));
  });
});
