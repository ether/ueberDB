'use strict';

const assert = require('assert').strict;
const ueberdb = require('../index');

describe(__filename, function () {
  let db;

  beforeEach(async function () {
    db = new ueberdb.Database('memory', {}, {});
    await db.init();
    await db.set('k', {s: 'v'});
  });

  afterEach(async function () {
    if (db != null) await db.close();
    db = null;
  });

  it('getSub stops at non-objects', async function () {
    assert(await db.getSub('k', ['s', 'length']) == null);
  });

  it('getSub ignores non-own properties', async function () {
    assert(await db.getSub('k', ['toString']) == null);
  });

  it('getSub ignores __proto__', async function () {
    assert(await db.getSub('k', ['__proto__']) == null);
  });
});
