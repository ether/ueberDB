import assert$0 from "assert";
import * as ueberdb from "../index.js";
'use strict';
const assert = assert$0.strict;
describe(__filename, function () {
    let db: any;
    beforeEach(async function () {
        // @ts-expect-error TS(2339): Property 'Database' does not exist on type 'typeof... Remove this comment to see the full error message
        db = new ueberdb.Database('memory', {}, {});
        await db.init();
        await db.set('k', { s: 'v' });
    });
    afterEach(async function () {
        if (db != null)
            await db.close();
        db = null;
    });
    it('getSub stops at non-objects', async function () {
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert((await db.getSub('k', ['s', 'length'])) == null);
    });
    it('getSub ignores non-own properties', async function () {
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert((await db.getSub('k', ['toString'])) == null);
    });
    it('getSub ignores __proto__', async function () {
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert((await db.getSub('k', ['__proto__'])) == null);
    });
});
