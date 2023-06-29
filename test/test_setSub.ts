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
    });
    afterEach(async function () {
        if (db != null)
            await db.close();
        db = null;
    });
    it('setSub rejects __proto__', async function () {
        await db.set('k', {});
        await assert.rejects(db.setSub('k', ['__proto__'], 'v'));
    });
});
