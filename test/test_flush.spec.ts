import {ConsoleLogger} from '../lib/logging';
import * as ueberdb from '../index';
import {afterAll, describe, it, afterEach, beforeEach, beforeAll, expect} from 'vitest'
const logger = new ConsoleLogger();
describe(__filename, () => {
  let db: any = null;
  let mock: any = null;
  const createDb = async (wrapperSettings = {}) => {
    const settings = {};
    db = new ueberdb.Database('mock', settings, {json: false, ...wrapperSettings}, logger);
    // @ts-ignore
    mock = settings.mock;
    mock.once('init', (cb: any) => cb());
    await db.init();
  };
  afterEach(async () => {
    if (mock != null) {
      mock.removeAllListeners();
      mock.once('close', (cb: any) => cb());
      mock = null;
    }
    if (db != null) {
      await db.close();
      db = null;
    }
  });
  it('flush() immediately after set() sees the write operation', async () => {
    // Trigger a test timeout if flush() completes before the write operation is buffered.
    await createDb({writeInterval: 1e9});
    mock.on('set', (k: any, v: any, cb: any) => cb());
    await Promise.all([
      db.set('key', 'value'),
      db.flush(),
    ]);
  });
  it('flush() immediately after setSub() sees the write operation', async () => {
    // Trigger a test timeout if flush() completes before the write operation is buffered.
    await createDb({writeInterval: 1e9});
    mock.on('get', (k: any, cb: any) => cb(null, {sub: 'oldvalue'}));
    mock.on('set', (k: any, v: any, cb: any) => cb(null));
    await Promise.all([
      db.setSub('key', ['sub'], 'newvalue'),
      db.flush(),
    ]);
  });
  it('flush() immediately after remove() sees the write operation', async () => {
    // Trigger a test timeout if flush() completes before the write operation is buffered.
    await createDb({writeInterval: 1e9});
    mock.on('remove', (k: any, cb: any) => cb(null));
    await Promise.all([
      db.remove('key'),
      db.flush(),
    ]);
  });
});
