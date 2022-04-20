'use strict';

const assert = require('assert').strict;
const ueberdb = require('../index');
const util = require('util');

const range = (N) => [...Array(N).keys()];

describe(__filename, function () {
  let db = null;
  let mock = null;
  const createDb = async (wrapperSettings) => {
    const settings = {};
    db = new ueberdb.Database('mock', settings, wrapperSettings);
    mock = settings.mock;
    mock.once('init', (cb) => cb());
    await db.init();
  };

  afterEach(async function () {
    if (mock != null) {
      mock.removeAllListeners();
      mock.once('close', (cb) => cb());
      mock = null;
    }
    if (db != null) {
      await db.close();
      db = null;
    }
  });

  describe('bulkLimit', function () {
    const bulkLimits = [0, false, null, undefined, '', 1, 2];
    for (const bulkLimit of bulkLimits) {
      it(bulkLimit === undefined ? 'undefined' : JSON.stringify(bulkLimit), async function () {
        await createDb({bulkLimit});
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

  it('bulk failures are retried individually', async function () {
    await createDb({});
    const gotDoBulkCalls = [];
    mock.on('doBulk', util.callbackify(async (ops) => {
      gotDoBulkCalls.push(ops.length);
      throw new Error('test');
    }));
    const gotWrites = new Map();
    const wantWrites = new Map();
    mock.on('set', util.callbackify(async (k, v) => gotWrites.set(k, v)));
    const N = 10;
    await Promise.all(range(N).map(async (i) => {
      const k = `key${i}`;
      const v = `val${i}`;
      wantWrites.set(k, JSON.stringify(v));
      await db.set(k, v);
    }));
    assert.deepEqual(gotDoBulkCalls, [N]);
    assert.deepEqual(gotWrites, wantWrites);
  });
});
