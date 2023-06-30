import assert$0 from "assert";
import * as ueberdb from "../index";
'use strict';
const assert = assert$0.strict;
describe(__filename, function () {
    let db: any = null;
    before(async function () {
        db = new ueberdb.Database('memory', {}, {});
        await db.init();
    });
    after(async function () {
        await db.close();
    });
    it('no .toJSON method', async function () {
        await db.set('key', { prop: 'value' });
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert.deepEqual(await db.get('key'), { prop: 'value' });
    });
    it('direct', async function () {
        await db.set('key', { toJSON: (arg: any) => `toJSON ${arg}` });
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert.equal(await db.get('key'), 'toJSON ');
    });
    it('object property', async function () {
        await db.set('key', { prop: { toJSON: (arg: any) => `toJSON ${arg}` } });
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert.deepEqual(await db.get('key'), { prop: 'toJSON prop' });
    });
    it('array entry', async function () {
        await db.set('key', [{ toJSON: (arg: any) => `toJSON ${arg}` }]);
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert.deepEqual(await db.get('key'), ['toJSON 0']);
    });
});
