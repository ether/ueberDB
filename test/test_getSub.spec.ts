import assert$0 from 'assert';
import * as ueberdb from '../index';
import {afterAll, describe, it, afterEach, beforeEach, beforeAll, expect} from 'vitest'
const assert = assert$0.strict;
describe(__filename, () => {
  let db: any;
  beforeEach(async () => {
    db = new ueberdb.Database('memory', {}, {});
    await db.init();
    await db.set('k', {s: 'v'});
  });
  afterEach(async () => {
    if (db != null) await db.close();
    db = null;
  });
  it('getSub stops at non-objects', async () => {
    // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
    assert((await db.getSub('k', ['s', 'length'])) == null);
  });
  it('getSub ignores non-own properties', async () => {
    // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
    assert((await db.getSub('k', ['toString'])) == null);
  });
  it('getSub ignores __proto__', async () => {
    // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
    assert((await db.getSub('k', ['__proto__'])) == null);
  });
});
