'use strict';

const assert = require('assert').strict;
const ueberdb = require('../index');
const util = require('util');

describe(__filename, function () {
  it('setSub rejects __proto__', async function () {
    const db = new ueberdb.Database('memory', {}, {});
    await util.promisify(db.init).call(db);
    await util.promisify(db.set).call(db, 'k', {});
    await assert.rejects(util.promisify(db.setSub).call(db, 'k', ['__proto__'], 'v'));
  });
});
