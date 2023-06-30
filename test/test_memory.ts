import assert$0 from "assert";
import * as memory from "../databases/memory_db.js";
'use strict';
const assert = assert$0.strict;

describe(__filename, function () {
    describe('data option', function () {
        it('uses existing records from data option', async function () {
            const db = new memory.Database({ data: new Map([['foo', 'bar']]) });
            await db.init();
            // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
            assert.equal(await db.get('foo'), 'bar');
        });
        it('updates existing map', async function () {
            const data = new Map();
            const db = new memory.Database({ data });
            await db.init();
            await db.set('foo', 'bar');
            // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
            assert.equal(data.get('foo'), 'bar');
        });
        it('does not clear map on close', async function () {
            const data = new Map();
            const db = new memory.Database({ data });
            await db.init();
            await db.set('foo', 'bar');
            await db.close();
            // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
            assert.equal(data.get('foo'), 'bar');
        });
    });
});
