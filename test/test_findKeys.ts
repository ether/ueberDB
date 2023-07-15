import assert$0 from 'assert';
import {ConsoleLogger} from '../lib/logging';
import * as ueberdb from '../index';
'use strict';
const assert = assert$0.strict;
const logger = new ConsoleLogger();
describe(__filename, () => {
  let db: any = null;
  let mock: any = null;
  const createDb = async (wrapperSettings = {}) => {
    const settings = {};
    db = new ueberdb.Database('mock', settings, {json: false, ...wrapperSettings}, logger);
    // @ts-expect-error TS(2339): Property 'mock' does not exist on type '{}'.
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
  it('cached entries are flushed before calling findKeys', async () => {
    // Trigger a test timeout if flush() completes before the write operation is buffered.
    await createDb({writeInterval: 1e9});
    let called = false;
    mock.on('set', (k: any, v: any, cb: any) => { called = true; cb(null); });
    // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
    mock.on('findKeys', (k: any, nk: any, cb: any) => { assert(called); cb(null, []); });
    await Promise.all([
      db.set('key', 'value'),
      db.findKeys('key', null),
    ]);
  });
});
