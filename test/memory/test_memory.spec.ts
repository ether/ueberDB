import assert$0 from 'assert';
import MemoryDB from '../../databases/memory_db';
import {fileURLToPath} from 'node:url';
import {describe, it} from 'node:test'
const assert = assert$0.strict;

describe(fileURLToPath(import.meta.url), () => {
  describe('data option', () => {
    it('uses existing records from data option', async () => {
      const db = new MemoryDB({data: new Map([['foo', 'bar']])});
      await db.init();
      // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
      assert.equal(await db.get('foo'), 'bar');
    });
    it('updates existing map', async () => {
      const data = new Map();
      const db = new MemoryDB({data});
      await db.init();
      await db.set('foo', 'bar');
      // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
      assert.equal(data.get('foo'), 'bar');
    });
    it('does not clear map on close', async () => {
      const data = new Map();
      const db = new MemoryDB({data});
      await db.init();
      await db.set('foo', 'bar');
      await db.close();
      // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
      assert.equal(data.get('foo'), 'bar');
    });
  });
});
