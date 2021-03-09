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

const assertMetricsDelta = (before, after, wantDelta) => {
  wantDelta = {...wantDelta};
  for (const [k, v] of Object.entries(wantDelta)) {
    if (v === 0) delete wantDelta[k];
  }
  assert.deepEqual(diffMetrics(before, after), wantDelta);
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
        const subtcs = [
          {
            name: 'cache miss',
            val: '{"s": "v"}',
            wantMetrics: {
              lockReleases: 1,
              readsFinished: 1,
              readsFromDbFinished: 1,
            },
          },
          {
            name: 'cache hit',
            cacheHit: true,
            val: '{"s": "v"}',
            wantMetrics: {
              lockAcquires: 1,
              lockReleases: 1,
              reads: 1,
              readsFinished: 1,
              readsFromCache: 1,
            },
          },
          {
            name: 'read error',
            err: new Error('test'),
            wantMetrics: {
              lockReleases: 1,
              readsFailed: 1,
              readsFinished: 1,
              readsFromDbFailed: 1,
              readsFromDbFinished: 1,
            },
          },
          {
            name: 'json error',
            val: 'ignore me -- this is intentionally invalid json',
            wantJsonErr: true,
            wantMetrics: {
              lockReleases: 1,
              readsFailed: 1,
              readsFinished: 1,
              readsFromDbFinished: 1,
            },
          },
        ];

        for (const subtc of subtcs) {
          it(subtc.name, async function () {
            if (subtc.cacheHit) {
              mock.once('get', (key, cb) => { cb(null, subtc.val); });
              await tc.f(key);
            }
            let finishDbRead;
            const dbReadStarted = new Promise((resolve) => {
              mock.once('get', (key, cb) => {
                assert(!subtc.cacheHit, 'value should have been cached');
                resolve();
                new Promise((resolve) => { finishDbRead = resolve; })
                    .then(() => cb(subtc.err, subtc.val));
              });
            });
            let before = {...db.metrics};
            let readFinished = tc.f(key);
            if (!subtc.cacheHit) {
              await dbReadStarted;
              assertMetricsDelta(before, db.metrics, {
                lockAcquires: 1,
                reads: 1,
                readsFromDb: 1,
              });
              before = {...db.metrics};
              finishDbRead();
            }
            if (subtc.err) readFinished = assert.rejects(readFinished, subtc.err);
            if (subtc.wantJsonErr) readFinished = assert.rejects(readFinished, {message: /JSON/});
            await readFinished;
            assertMetricsDelta(before, db.metrics, subtc.wantMetrics);
          });
        }

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
          await tc.f(key);
          assertMetricsDelta(before, db.metrics, {
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
      {name: 'setSub', fn: 'set', nReads: 1, f: (key) => db.setSub(key, ['s'], 'v')},
      {name: 'doBulk', nWrites: 2, f: (key) => Promise.all([
        db.set(key, 'v'),
        db.set(`${key} second op`, 'v'),
      ])},
      {name: 'obsoleted', fn: 'set', nWrites: 2, nDbWrites: 1, f: (key) => Promise.all([
        db.set(key, 'v'),
        db.set(key, 'v2'),
      ])},
    ];

    for (const tc of tcs) {
      if (tc.fn == null) tc.fn = tc.name;
      if (tc.nWrites == null) tc.nWrites = 1;
      if (tc.nDbWrites == null) tc.nDbWrites = tc.nWrites;
      if (tc.nReads == null) tc.nReads = 0;

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
            assertMetricsDelta(before, db.metrics, {
              lockAcquires: tc.nWrites,
              lockAwaits: tc.nWrites - tc.nDbWrites,
              lockReleases: tc.nWrites,
              reads: tc.nReads,
              readsFinished: tc.nReads,
              readsFromCache: tc.nReads,
              writes: tc.nWrites,
              writesObsoleted: tc.nWrites - tc.nDbWrites,
              writesToDb: tc.nDbWrites,
            });
            before = {...db.metrics};
            finishWrite();
            await (failWrite ? assert.rejects(writeFinished, {message: 'test'}) : writeFinished);
            await flushed;
            assertMetricsDelta(before, db.metrics, {
              writesFailed: failWrite ? tc.nWrites : 0,
              writesFinished: tc.nWrites,
              writesToDbFailed: failWrite ? tc.nDbWrites : 0,
              writesToDbFinished: tc.nDbWrites,
            });
          });
        }
      });
    }
  });

  describe('lock contention', function () {
    const tcs = [
      {
        name: 'get',
        f: (key) => db.get(key),
        wantMetrics: {lockAwaits: 1},
      },
      {
        name: 'getSub',
        fn: 'get',
        f: (key) => db.getSub(key, ['s']),
        wantMetrics: {lockAwaits: 1},
      },
      {
        name: 'remove',
        f: (key) => db.remove(key),
        wantMetrics: {lockAwaits: 1},
      },
      {
        name: 'set',
        f: (key) => db.set(key, 'v'),
        wantMetrics: {lockAwaits: 1},
      },
      {
        name: 'setSub',
        fn: 'set',
        f: (key) => db.setSub(key, ['s'], 'v'),
        wantMetrics: {lockAwaits: 1},
      },
      {
        name: 'doBulk',
        f: (key) => Promise.all([
          db.set(key, 'v'),
          db.set(`${key} second op`, 'v'),
        ]),
        wantMetrics: {lockAcquires: 1, lockAwaits: 1},
      },
    ];

    for (const tc of tcs) {
      if (tc.fn == null) tc.fn = tc.name;

      it(tc.name, async function () {
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
        const getP = db.get(key);
        await readStarted;
        mock.once(tc.fn, (...args) => {
          assert(tc.fn !== 'get', 'value should have been cached');
          args.pop()();
        });
        const before = {...db.metrics};
        const opFinished = tc.f(key);
        const flushed = db.flush(); // Speed up tests.
        assertMetricsDelta(before, db.metrics, tc.wantMetrics);
        finishRead();
        await getP;
        await opFinished;
        await flushed;
      });
    }
  });
});
