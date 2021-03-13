'use strict';

const assert = require('assert').strict;
const ueberdb = require('../index');
const util = require('util');

const range = (N) => [...Array(N).keys()];

describe(__filename, function () {
  describe('bulkLimit', function () {
    let db;
    let mock;

    afterEach(async function () {
      mock.removeAllListeners();
      mock.once('close', (cb) => cb());
      await db.close();
    });

    const bulkLimits = [0, false, null, undefined, '', 1, 2];
    for (const bulkLimit of bulkLimits) {
      it(bulkLimit === undefined ? 'undefined' : JSON.stringify(bulkLimit), async function () {
        const settings = {};
        const udb = new ueberdb.Database('mock', settings, {bulkLimit, writeInterval: 1});
        mock = settings.mock;
        db = {};
        for (const fn of ['init', 'close', 'set']) db[fn] = util.promisify(udb[fn].bind(udb));
        mock.once('init', (cb) => cb());
        await db.init();

        const gotWrites = [];
        mock.on('set', util.callbackify(async (k, v) => gotWrites.push(1)));
        mock.on('doBulk', util.callbackify(async (ops) => gotWrites.push(ops.length)));
        const N = 10;
        await Promise.all(range(N).map((i) => db.set(`key${i}`, `val${i}`)));
        const wantLimit = bulkLimit || N;
        const wantWrites = range(N / wantLimit).map((i) => wantLimit);
        assert.deepEqual(gotWrites, wantWrites);
      });
    }
  });
});
