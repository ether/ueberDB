import assert$0 from 'assert';
import * as ueberdb from '../index';
import {afterAll, describe, it, afterEach, beforeEach, beforeAll, expect} from 'vitest'

const assert = assert$0.strict;
describe(__filename, () => {
  let db: any = null;
  beforeAll(async () => {
    db = new ueberdb.Database('memory', {}, {});
    await db.init();
  });
  afterAll(async () => {
    await db.close();
  });
  it('no .toJSON method', async () => {
    await db.set('key', {prop: 'value'});
    // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
    assert.deepEqual(await db.get('key'), {prop: 'value'});
  });
  it('direct', async () => {
    await db.set('key', {toJSON: (arg: any) => `toJSON ${arg}`});
    // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
    assert.equal(await db.get('key'), 'toJSON ');
  });
  it('object property', async () => {
    await db.set('key', {prop: {toJSON: (arg: any) => `toJSON ${arg}`}});
    // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
    assert.deepEqual(await db.get('key'), {prop: 'toJSON prop'});
  });
  it('array entry', async () => {
    await db.set('key', [{toJSON: (arg: any) => `toJSON ${arg}`}]);
    // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
    assert.deepEqual(await db.get('key'), ['toJSON 0']);
  });
});
