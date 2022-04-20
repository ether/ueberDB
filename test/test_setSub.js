'use strict';

const assert = require('assert').strict;
const ueberdb = require('../index');

describe(__filename, function () {
  it('setSub rejects __proto__', async function () {
    const db = new ueberdb.Database('memory', {}, {});
    await db.init();
    await db.set('k', {});
    await assert.rejects(db.setSub('k', ['__proto__'], 'v'));
  });
});
