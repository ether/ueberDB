import {exportedForTesting} from '../../lib/CacheAndBufferLayer';
import assert$0 from 'assert';
import {afterAll, describe, it, afterEach, beforeEach, beforeAll, expect} from 'vitest'
const LRU = {exportedForTesting}.exportedForTesting.LRU;
const assert = assert$0.strict;
describe(__filename, () => {
  describe('capacity = 0', () => {
    it('constructor does not throw', async () => {
      new LRU(0);
    });
    describe('behavior when empty', () => {
      it('get() returns nullish', async () => {
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert((new LRU(0)).get('k') == null);
      });
      it('empty iteration', async () => {
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert.equal([...(new LRU(0))].length, 0);
      });
      it('evictOld() does not throw', async () => {
        (new LRU(0)).evictOld();
      });
    });
    describe('single entry with evictable = false', () => {
      let evictable: any, lru: any, key: any, val: any;
      beforeEach(async () => {
        evictable = false;
        lru = new LRU(0, () => evictable);
        key = 'k';
        val = 'v';
        lru.set(key, val);
      });
      it('get() works', async () => {
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert.equal(lru.get(key), val);
      });
      it('iterate works', async () => {
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert.deepEqual([...lru], [[key, val]]);
      });
      it('re-set() works', async () => {
        const val2 = 'v2';
        lru.set(key, val2);
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert.equal(lru.get(key), val2);
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert.deepEqual([...lru], [[key, val2]]);
      });
      it('evictOld() does not evict', async () => {
        lru.evictOld();
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert.deepEqual([...lru], [[key, val]]);
      });
      it('evictOld() evicts after setting evictable = true', async () => {
        evictable = true;
        lru.evictOld();
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert.deepEqual([...lru], []);
      });
    });
    describe('set immediately evicts if evictable', () => {
      it('explicitly evictable', async () => {
        const lru = new LRU(0, () => true);
        lru.set('k', 'v');
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert(lru.get('k') == null);
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert.deepEqual([...lru], []);
      });

      it('is evictable by default', async () => {
        const lru = new LRU(0);
        lru.set('k', 'v');
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert(lru.get('k') == null);
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert.deepEqual([...lru], []);
      });
    });
  });
  describe('capacity = 2', () => {
    let evictable: any, lru: any;
    beforeEach(async () => {
      evictable = () => false;
      lru = new LRU(2, (k: any, v: any) => evictable(k, v));
    });
    it('iterates oldest first', async () => {
      lru.set(0, '0');
      lru.set(1, '1');
      let i = 0;
      for (const [k, v] of lru) {
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert.equal(k, i);
        // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
        assert.equal(v, `${i}`);
        i++;
      }
      // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
      assert.equal(i, 2);
    });
    it('get(k) updates recently used', async () => {
      lru.set(0, '0');
      lru.set(1, '1');
      // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
      assert.equal(lru.get(0), '0');
      // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
      assert.deepEqual([...lru], [[1, '1'], [0, '0']]);
    });
    it('get(k, false) does not update recently used', async () => {
      lru.set(0, '0');
      lru.set(1, '1');
      // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
      assert.equal(lru.get(0, false), '0');
      // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
      assert.deepEqual([...lru], [[0, '0'], [1, '1']]);
    });
    it('re-set() updates recently used', async () => {
      lru.set(0, '0');
      lru.set(1, '1');
      lru.set(0, '00');
      // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
      assert.deepEqual([...lru], [[1, '1'], [0, '00']]);
    });
    it('evictOld() only evicts evictable entries', async () => {
      evictable = () => false;
      lru.set(0, '0');
      lru.set(1, '1');
      lru.set(2, '2');
      lru.set(3, '3');
      // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
      assert.deepEqual([...lru], [[0, '0'], [1, '1'], [2, '2'], [3, '3']]);
      evictable = (k: any) => k >= 2;
      lru.evictOld();
      // The newer entries should be evicted because the older are dirty/writingInProgress.
      // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
      assert.deepEqual([...lru], [[0, '0'], [1, '1']]);
    });
    it('evictOld() does nothing if at or below capacity', async () => {
      evictable = () => true;
      lru.set(0, '0');
      lru.evictOld();
      // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
      assert.deepEqual([...lru], [[0, '0']]);
      lru.set(1, '1');
      lru.evictOld();
      // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
      assert.deepEqual([...lru], [[0, '0'], [1, '1']]);
    });
  });
});
