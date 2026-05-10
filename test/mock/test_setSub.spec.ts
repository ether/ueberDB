import assert$0 from 'assert';
import * as ueberdb from '../../index.ts';
import {fileURLToPath} from 'node:url';
import {describe, it, afterEach, beforeEach} from 'node:test'

const assert = assert$0.strict;
describe(fileURLToPath(import.meta.url), () => {
  let db: any;
  beforeEach(async () => {
    db = new ueberdb.Database('memory', {}, {});
    await db.init();
  });
  afterEach(async () => {
    if (db != null) await db.close();
    db = null;
  });
  it('setSub rejects __proto__', async () => {
    await db.set('k', {});
    await assert.rejects(db.setSub('k', ['__proto__'], 'v'));
  });
});
