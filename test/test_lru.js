'use strict';

const LRU = require('../lib/CacheAndBufferLayer').exportedForTesting.LRU;
const assert = require('assert').strict;

describe(__filename, function () {
  describe('capacity = 0', function () {
    it('constructor does not throw', async function () {
      new LRU(0);
    });

    describe('behavior when empty', function () {
      it('get() returns nullish', async function () {
        assert((new LRU(0)).get('k') == null);
      });

      it('empty iteration', async function () {
        assert.equal([...(new LRU(0))].length, 0);
      });

      it('evictOld() does not throw', async function () {
        (new LRU(0)).evictOld();
      });
    });

    describe('single entry with evictable = false', function () {
      let evictable, lru, key, val;

      beforeEach(async function () {
        evictable = false;
        lru = new LRU(0, () => evictable);
        key = 'k';
        val = 'v';
        lru.set(key, val);
      });

      it('get() works', async function () {
        assert.equal(lru.get(key), val);
      });

      it('iterate works', async function () {
        assert.deepEqual([...lru], [[key, val]]);
      });

      it('re-set() works', async function () {
        const val2 = 'v2';
        lru.set(key, val2);
        assert.equal(lru.get(key), val2);
        assert.deepEqual([...lru], [[key, val2]]);
      });

      it('evictOld() does not evict', async function () {
        lru.evictOld();
        assert.deepEqual([...lru], [[key, val]]);
      });

      it('evictOld() evicts after setting evictable = true', async function () {
        evictable = true;
        lru.evictOld();
        assert.deepEqual([...lru], []);
      });
    });

    describe('set immediately evicts if evictable', function () {
      it('explicitly evictable', async function () {
        const lru = new LRU(0, () => true);
        lru.set('k', 'v');
        assert(lru.get('k') == null);
        assert.deepEqual([...lru], []);
      });

      it('is evictable by default', async function () {
        const lru = new LRU(0);
        lru.set('k', 'v');
        assert(lru.get('k') == null);
        assert.deepEqual([...lru], []);
      });
    });
  });

  describe('capacity = 2', function () {
    let evictable, lru;

    beforeEach(async function () {
      evictable = () => false;
      lru = new LRU(2, (k, v) => evictable(k, v));
    });

    it('iterates oldest first', async function () {
      lru.set(0, '0');
      lru.set(1, '1');
      let i = 0;
      for (const [k, v] of lru) {
        assert.equal(k, i);
        assert.equal(v, `${i}`);
        i++;
      }
      assert.equal(i, 2);
    });

    it('get(k) updates recently used', async function () {
      lru.set(0, '0');
      lru.set(1, '1');
      assert.equal(lru.get(0), '0');
      assert.deepEqual([...lru], [[1, '1'], [0, '0']]);
    });

    it('get(k, false) does not update recently used', async function () {
      lru.set(0, '0');
      lru.set(1, '1');
      assert.equal(lru.get(0, false), '0');
      assert.deepEqual([...lru], [[0, '0'], [1, '1']]);
    });

    it('re-set() updates recently used', async function () {
      lru.set(0, '0');
      lru.set(1, '1');
      lru.set(0, '00');
      assert.deepEqual([...lru], [[1, '1'], [0, '00']]);
    });

    it('evictOld() only evicts evictable entries', async function () {
      evictable = () => false;
      lru.set(0, '0');
      lru.set(1, '1');
      lru.set(2, '2');
      lru.set(3, '3');
      assert.deepEqual([...lru], [[0, '0'], [1, '1'], [2, '2'], [3, '3']]);
      evictable = (k) => k >= 2;
      lru.evictOld();
      // The newer entries should be evicted because the older are dirty/writingInProgress.
      assert.deepEqual([...lru], [[0, '0'], [1, '1']]);
    });

    it('evictOld() does nothing if at or below capacity', async function () {
      evictable = () => true;
      lru.set(0, '0');
      lru.evictOld();
      assert.deepEqual([...lru], [[0, '0']]);
      lru.set(1, '1');
      lru.evictOld();
      assert.deepEqual([...lru], [[0, '0'], [1, '1']]);
    });
  });
});
