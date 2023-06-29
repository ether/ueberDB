import assert$0 from "assert";
// @ts-expect-error TS(2306): File '/mnt/c/Users/samue/WebstormProjects/ueberDB/... Remove this comment to see the full error message
import { databases } from "./lib/databases.js";
import * as ueberdb from "../index.js";
'use strict';
const assert = assert$0.strict;
describe(__filename, function () {
    it('connection string instead of settings object', async function () {
        const { user, password, host, database } = databases.postgres;
        // @ts-expect-error TS(2339): Property 'Database' does not exist on type 'typeof... Remove this comment to see the full error message
        const db = new ueberdb.Database('postgres', `postgres://${user}:${password}@${host}/${database}`);
        await db.init();
        await db.set('key', 'val');
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert.equal(await db.get('key'), 'val');
    });
});
