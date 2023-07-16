import {strict} from 'assert';
import {Database} from '../index';
import util from 'util';
'use strict';
const assert = strict
const range = (N: any) => [...Array(N).keys()];
describe(__filename, () => {
  let db: any = null;
  let mock: any = null;
  const createDb = async (wrapperSettings: any) => {
    const settings = {};
    db = new Database('mock', settings, wrapperSettings);
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
  describe('bulkLimit', () => {
    const bulkLimits = [0, false, null, undefined, '', 1, 2];
    for (const bulkLimit of bulkLimits) {
      it(bulkLimit === undefined ? 'undefined' : JSON.stringify(bulkLimit), async () => {
        await createDb({bulkLimit});
        const gotWrites: any = [];
        mock.on('set', util.callbackify(async (k: any, v: any) => gotWrites.push(1)));
        mock.on('doBulk', util.callbackify(async (ops: any) => gotWrites.push(ops.length)));
        const N = 10;
        await Promise.all(range(N).map((i) => db.set(`key${i}`, `val${i}`)));
        const wantLimit = bulkLimit || N;
        // @ts-expect-error TS(2363): The right-hand side of an arithmetic operation mus... Remove this comment to see the full error message
        const wantWrites = range(N / wantLimit).map((i) => wantLimit);
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert.deepEqual(gotWrites, wantWrites);
      });
    }
  });
  it('bulk failures are retried individually', async () => {
    await createDb({});
    const gotDoBulkCalls: any = [];
    mock.on('doBulk', util.callbackify(async (ops: any) => {
      gotDoBulkCalls.push(ops.length);
      throw new Error('test');
    }));
    const gotWrites = new Map();
    const wantWrites = new Map();
    mock.on('set', util.callbackify(async (k: any, v: any) => gotWrites.set(k, v)));
    const N = 10;
    await Promise.all(range(N).map(async (i) => {
      const k = `key${i}`;
      const v = `val${i}`;
      wantWrites.set(k, JSON.stringify(v));
      await db.set(k, v);
    }));
    // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
    assert.deepEqual(gotDoBulkCalls, [N]);
    // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
    assert.deepEqual(gotWrites, wantWrites);
  });
});
