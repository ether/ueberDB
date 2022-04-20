'use strict';

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

  it('flush() immediately after set() sees the write operation', async function () {
    // Trigger a test timeout if flush() completes before the write operation is buffered.
    await createDb({writeInterval: 1e9});
    mock.on('set', (k, v, cb) => cb());
    await Promise.all([
      db.set('key', 'value'),
      db.flush(),
    ]);
  });

  it('flush() immediately after setSub() sees the write operation', async function () {
    // Trigger a test timeout if flush() completes before the write operation is buffered.
    await createDb({writeInterval: 1e9});
    mock.on('get', (k, cb) => cb(null, {sub: 'oldvalue'}));
    mock.on('set', (k, v, cb) => cb(null));
    await Promise.all([
      db.setSub('key', ['sub'], 'newvalue'),
      db.flush(),
    ]);
  });

  it('flush() immediately after remove() sees the write operation', async function () {
    // Trigger a test timeout if flush() completes before the write operation is buffered.
    await createDb({writeInterval: 1e9});
    mock.on('remove', (k, cb) => cb(null));
    await Promise.all([
      db.remove('key'),
      db.flush(),
    ]);
  });
});
