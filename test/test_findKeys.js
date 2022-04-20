'use strict';

const assert = require('assert').strict;
const logging = require('../lib/logging');
const ueberdb = require('../index');

const logger = new logging.ConsoleLogger();

describe(__filename, function () {
  let db = null;
  let mock = null;
  const createDb = async (wrapperSettings = {}) => {
    const settings = {};
    db = new ueberdb.Database('mock', settings, {json: false, ...wrapperSettings}, logger);
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

  it('cached entries are flushed before calling findKeys', async function () {
    // Trigger a test timeout if flush() completes before the write operation is buffered.
    await createDb({writeInterval: 1e9});
    let called = false;
    mock.on('set', (k, v, cb) => { called = true; cb(null); });
    mock.on('findKeys', (k, nk, cb) => { assert(called); cb(null, []); });
    await Promise.all([
      db.set('key', 'value'),
      db.findKeys('key', null),
    ]);
  });
});
