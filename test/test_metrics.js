'use strict';

const assert = require('assert').strict;
const ueberdb = require('../index');
const util = require('util');

const diffMetrics = (before, after) => {
  const diff = {};
  assert.equal(Object.keys(before).length, Object.keys(after).length);
  for (const [k, bv] of Object.entries(before)) {
    assert(bv != null);
    const av = after[k];
    assert(av != null);
    if (av - bv > 0) diff[k] = av - bv;
  }
  return diff;
};

describe(__filename, function () {
  let db;
  let key;
  let mock;

  before(async function () {
    const settings = {};
    const udb = new ueberdb.Database('mock', settings);
    mock = settings.mock;
    db = {metrics: udb.metrics};
    const fns = ['init', 'close', 'get', 'getSub', 'findKeys', 'flush', 'remove', 'set', 'setSub'];
    for (const fn of fns) db[fn] = util.promisify(udb[fn].bind(udb));
    mock.once('init', (cb) => cb());
    await db.init();
  });

  after(async function () {
    mock.once('close', (cb) => cb());
    await db.close();
  });

  beforeEach(async function () {
    key = this.currentTest.fullTitle(); // Use test title to avoid collisions with other tests.
  });

  afterEach(async function () {
    mock.removeAllListeners();
  });

  describe('reads', function () {
    const tcs = [
      {name: 'get', f: (key) => db.get(key)},
      {name: 'getSub', f: (key) => db.getSub(key, ['s'])},
    ];

    for (const tc of tcs) {
      describe(tc.name, function () {
        it('cache miss', async function () {
          let before = {...db.metrics};
          mock.once('get', (key, cb) => {
            assert.deepEqual(diffMetrics(before, db.metrics), {lockAcquires: 1, reads: 1});
            before = {...db.metrics};
            cb(null, '{"s": "v"}');
          });
          await tc.f(key);
          assert.deepEqual(diffMetrics(before, db.metrics), {lockReleases: 1, readsFinished: 1});
        });

        it('cache hit', async function () {
          mock.once('get', (key, cb) => { cb(null, '{"s": "v"}'); });
          await tc.f(key);
          const before = {...db.metrics};
          mock.once('get', (key, cb) => { assert.fail('value should be cached'); });
          await tc.f(key);
          assert.deepEqual(diffMetrics(before, db.metrics), {
            lockAcquires: 1,
            lockReleases: 1,
            reads: 1,
            readsFinished: 1,
            readsFromCache: 1,
          });
        });

        it('read error', async function () {
          let before = {...db.metrics};
          mock.once('get', (key, cb) => {
            assert.deepEqual(diffMetrics(before, db.metrics), {lockAcquires: 1, reads: 1});
            before = {...db.metrics};
            cb(new Error('test'));
          });
          await assert.rejects(tc.f(key), {message: 'test'});
          assert.deepEqual(diffMetrics(before, db.metrics), {
            lockReleases: 1,
            readsFailed: 1,
            readsFinished: 1,
          });
        });

        it('json error', async function () {
          let before = {...db.metrics};
          mock.once('get', (key, cb) => {
            assert.deepEqual(diffMetrics(before, db.metrics), {lockAcquires: 1, reads: 1});
            before = {...db.metrics};
            cb(null, 'ignore me -- this is intentionally invalid json');
          });
          await assert.rejects(tc.f(key), {message: /JSON/});
          assert.deepEqual(diffMetrics(before, db.metrics), {
            lockReleases: 1,
            readsFailed: 1,
            readsFinished: 1,
          });
        });

        it('lock contention', async function () {
          let finishRead;
          const readStarted = new Promise((resolve) => {
            mock.once('get', (key, cb) => {
              resolve();
              const val = '{"s": "v"}';
              new Promise((resolve) => { finishRead = resolve; }).then(() => cb(null, val));
            });
          });
          // Note: All contention tests should be with get() to ensure that all functions lock using
          // the record's key.
          const p1 = db.get(key);
          await readStarted;
          mock.once('get', (key, cb) => { assert.fail('value should be cached'); });
          const before = {...db.metrics};
          const p2 = tc.f(key);
          assert.deepEqual(diffMetrics(before, db.metrics), {lockAwaits: 1});
          finishRead();
          assert.deepEqual(await p1, {s: 'v'});
          await p2;
        });

        it('read of in-progress write', async function () {
          let finishWrite;
          const writeStarted = new Promise((resolve) => {
            mock.once('set', (key, val, cb) => {
              resolve();
              new Promise((resolve) => { finishWrite = resolve; }).then(() => cb());
            });
          });
          const writeFinished = db.set(key, {s: 'v'});
          const flushed = db.flush(); // Speed up the tests.
          await writeStarted;
          mock.once('get', (key, cb) => { assert.fail('value should be cached'); });
          const before = {...db.metrics};
          assert.equal(await db.getSub(key, ['s']), 'v');
          assert.deepEqual(diffMetrics(before, db.metrics), {
            lockAcquires: 1,
            lockReleases: 1,
            reads: 1,
            readsFinished: 1,
            readsFromCache: 1,
          });
          finishWrite();
          await writeFinished;
          await flushed;
        });
      });
    }
  });

  describe('writes', function () {
    const tcs = [
      {name: 'remove', f: (key) => db.remove(key)},
      {name: 'set', f: (key) => db.set(key, 'v')},
      {name: 'setSub', fn: 'set', f: (key) => db.setSub(key, ['s'], 'v')},
      {name: 'doBulk', f: (key) => Promise.all([
        db.set(key, 'v'),
        db.set(`${key}2`, 'v'),
      ]), nOps: 2},
    ];

    for (const tc of tcs) {
      if (tc.nOps == null) tc.nOps = 1;
      if (tc.fn == null) tc.fn = tc.name;
      describe(tc.name, function () {
        for (const failWrite of [false, true]) {
          it(failWrite ? 'error' : 'ok', async function () {
            // Seed with a value that can be read by the setSub test.
            mock.once('set', (key, val, cb) => cb());
            await db.set(key, {s: 'v'});
            let finishWrite;
            const writeStarted = new Promise((resolve) => {
              mock.once(tc.fn, (...args) => {
                const cb = args.pop();
                resolve();
                const err = failWrite ? new Error('test') : null;
                new Promise((resolve) => { finishWrite = resolve; }).then(() => cb(err));
              });
            });
            let before = {...db.metrics};
            const writeFinished = tc.f(key);
            const flushed = db.flush(); // Speed up the tests.
            await writeStarted;
            assert.deepEqual(diffMetrics(before, db.metrics), {
              lockAcquires: tc.nOps,
              lockReleases: tc.nOps,
              ...tc.name === 'setSub' ? {
                reads: 1,
                readsFinished: 1,
                readsFromCache: 1,
              } : {},
              writes: tc.nOps,
              writesStarted: tc.nOps,
            });
            before = {...db.metrics};
            finishWrite();
            await failWrite ? assert.rejects(writeFinished, {message: 'test'}) : writeFinished;
            await flushed;
            assert.deepEqual(diffMetrics(before, db.metrics), {
              writesFinished: tc.nOps,
              ...failWrite ? {writesFailed: tc.nOps} : {},
            });
          });
        }

        it('lock contention', async function () {
          let finishRead;
          const readStarted = new Promise((resolve) => {
            mock.once('get', (key, cb) => {
              resolve();
              const val = '{"s": "v"}';
              new Promise((resolve) => { finishRead = resolve; }).then(() => cb(null, val));
            });
          });
          // Note: All contention tests should be with get() to ensure that all functions lock using
          // the record's key.
          const valP = db.get(key);
          await readStarted;
          mock.once(tc.fn, (...args) => args.pop()());
          const before = {...db.metrics};
          const writeFinished = tc.f(key);
          const flushed = db.flush();
          assert.deepEqual(diffMetrics(before, db.metrics), {
            ...tc.nOps > 1 ? {
              lockAcquires: tc.nOps - 1,
            } : {},
            lockAwaits: 1,
          });
          finishRead();
          assert.deepEqual(await valP, {s: 'v'});
          await writeFinished;
          await flushed;
        });
      });
    }
  });
});
