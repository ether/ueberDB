'use strict';

const assert = require('assert').strict;
const memory = require('../databases/memory_db');

describe(__filename, function () {
  describe('data option', function () {
    it('uses existing records from data option', async function () {
      const db = new memory.Database({data: new Map([['foo', 'bar']])});
      await db.init();
      assert.equal(await db.get('foo'), 'bar');
    });

    it('updates existing map', async function () {
      const data = new Map();
      const db = new memory.Database({data});
      await db.init();
      await db.set('foo', 'bar');
      assert.equal(data.get('foo'), 'bar');
    });

    it('does not clear map on close', async function () {
      const data = new Map();
      const db = new memory.Database({data});
      await db.init();
      await db.set('foo', 'bar');
      await db.close();
      assert.equal(data.get('foo'), 'bar');
    });
  });
});
