'use strict';

const assert = require('assert').strict;
const ueberdb = require('../index');

// Gate is a normal Promise that resolves when its open() method is called.
class Gate extends Promise {
  constructor(executor = null) {
    let open;
    super((resolve, reject) => {
      open = resolve;
      if (executor != null) executor(resolve, reject);
    });
    this.open = open;
  }
}

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
    db = new ueberdb.Database('mock', settings);
    mock = settings.mock;
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
      {
        name: 'remove ok',
        action: async () => await db.remove(key),
        wantOps: [
          {
            wantFns: ['remove'],
            wantMetricsDelta: {
              lockAcquires: 1,
              lockReleases: 1,
              writes: 1,
              writesToDb: 1,
            },
            cbArgs: [[null]],
          },
        ],
        wantErr: null,
        wantMetricsDelta: {
          writesFinished: 1,
          writesToDbFinished: 1,
        },
      },
      {
        name: 'remove error',
        action: async () => await db.remove(key),
        wantOps: [
          {
            wantFns: ['remove'],
            wantMetricsDelta: {
              lockAcquires: 1,
              lockReleases: 1,
              writes: 1,
              writesToDb: 1,
            },
            cbArgs: [[new Error('test')]],
          },
        ],
        wantErr: {message: 'test'},
        wantMetricsDelta: {
          writesFailed: 1,
          writesFinished: 1,
          writesToDbFailed: 1,
          writesToDbFinished: 1,
        },
      },
      {
        name: 'set ok',
        action: async () => await db.set(key, 'v'),
        wantOps: [
          {
            wantFns: ['set'],
            wantMetricsDelta: {
              lockAcquires: 1,
              lockReleases: 1,
              writes: 1,
              writesToDb: 1,
            },
            cbArgs: [[null]],
          },
        ],
        wantErr: null,
        wantMetricsDelta: {
          writesFinished: 1,
          writesToDbFinished: 1,
        },
      },
      {
        name: 'set db error',
        action: async () => await db.set(key, 'v'),
        wantOps: [
          {
            wantFns: ['set'],
            wantMetricsDelta: {
              lockAcquires: 1,
              lockReleases: 1,
              writes: 1,
              writesToDb: 1,
            },
            cbArgs: [[new Error('test')]],
          },
        ],
        wantErr: {message: 'test'},
        wantMetricsDelta: {
          writesFailed: 1,
          writesFinished: 1,
          writesToDbFailed: 1,
          writesToDbFinished: 1,
        },
      },
      {
        name: 'set json error',
        action: async () => await db.set(key, BigInt(1)), // BigInts are not JSONable.
        wantOps: [],
        wantErr: {name: 'TypeError'},
        wantMetricsDelta: {
          lockAcquires: 1,
          lockReleases: 1,
          writes: 1,
          writesFailed: 1,
          writesFinished: 1,
        },
      },
      {
        name: 'setSub ok',
        action: async () => await db.setSub(key, ['s'], 'v2'),
        wantOps: [
          {
            wantFns: ['get'],
            wantMetricsDelta: {
              lockAcquires: 1,
              reads: 1,
              readsFromDb: 1,
            },
            cbArgs: [[null, '{"s": "v1"}']],
          },
          {
            wantFns: ['set'],
            wantMetricsDelta: {
              lockReleases: 1,
              readsFinished: 1,
              readsFromDbFinished: 1,
              writes: 1,
              writesToDb: 1,
            },
            cbArgs: [[null]],
          },
        ],
        wantErr: null,
        wantMetricsDelta: {
          writesFinished: 1,
          writesToDbFinished: 1,
        },
      },
      {
        name: 'setSub db write error',
        action: async () => await db.setSub(key, ['s'], 'v2'),
        wantOps: [
          {
            wantFns: ['get'],
            wantMetricsDelta: {
              lockAcquires: 1,
              reads: 1,
              readsFromDb: 1,
            },
            cbArgs: [[null, '{"s": "v1"}']],
          },
          {
            wantFns: ['set'],
            wantMetricsDelta: {
              lockReleases: 1,
              readsFinished: 1,
              readsFromDbFinished: 1,
              writes: 1,
              writesToDb: 1,
            },
            cbArgs: [[new Error('test')]],
          },
        ],
        wantErr: {message: 'test'},
        wantMetricsDelta: {
          writesFailed: 1,
          writesFinished: 1,
          writesToDbFailed: 1,
          writesToDbFinished: 1,
        },
      },
      {
        name: 'setSub db read error',
        action: async () => await db.setSub(key, ['s'], 'v2'),
        wantOps: [
          {
            wantFns: ['get'],
            wantMetricsDelta: {
              lockAcquires: 1,
              reads: 1,
              readsFromDb: 1,
            },
            cbArgs: [[new Error('test')]],
          },
        ],
        wantErr: {message: 'test'},
        wantMetricsDelta: {
          lockReleases: 1,
          readsFailed: 1,
          readsFinished: 1,
          readsFromDbFailed: 1,
          readsFromDbFinished: 1,
          writes: 1,
          writesFailed: 1,
          writesFinished: 1,
        },
      },
      {
        name: 'setSub json read error',
        action: async () => await db.setSub(key, ['s'], 'v2'),
        wantOps: [
          {
            wantFns: ['get'],
            wantMetricsDelta: {
              lockAcquires: 1,
              reads: 1,
              readsFromDb: 1,
            },
            cbArgs: [[null, 'ignore me -- this is intentionally invalid json']],
          },
        ],
        wantErr: {name: 'SyntaxError'},
        wantMetricsDelta: {
          lockReleases: 1,
          readsFailed: 1,
          readsFinished: 1,
          readsFromDbFinished: 1,
          writes: 1,
          writesFailed: 1,
          writesFinished: 1,
        },
      },
      {
        name: 'setSub update non-object error',
        action: async () => await db.setSub(key, ['s'], 'v2'),
        wantOps: [
          {
            wantFns: ['get'],
            wantMetricsDelta: {
              lockAcquires: 1,
              reads: 1,
              readsFromDb: 1,
            },
            cbArgs: [[null, '"foo"']],
          },
        ],
        wantErr: {message: /non-object/},
        wantMetricsDelta: {
          lockReleases: 1,
          readsFinished: 1,
          readsFromDbFinished: 1,
          writes: 1,
          writesFailed: 1,
          writesFinished: 1,
        },
      },
      {
        name: 'setSub json write error',
        action: async () => await db.setSub(key, ['s'], BigInt(1)), // BigInts are not JSONable.
        wantOps: [
          {
            wantFns: ['get'],
            wantMetricsDelta: {
              lockAcquires: 1,
              reads: 1,
              readsFromDb: 1,
            },
            cbArgs: [[null, '{"s": "v1"}']],
          },
        ],
        wantErr: {name: 'TypeError'},
        wantMetricsDelta: {
          lockReleases: 1,
          readsFinished: 1,
          readsFromDbFinished: 1,
          writes: 1,
          writesFailed: 1,
          writesFinished: 1,
        },
      },
      {
        name: 'doBulk ok',
        action: async () => await Promise.all([db.set(key, 'v'), db.set(`${key} second op`, 'v')]),
        wantOps: [
          {
            wantFns: ['doBulk'],
            wantMetricsDelta: {
              lockAcquires: 2,
              lockReleases: 2,
              writes: 2,
              writesToDb: 2,
            },
            cbArgs: [[null]],
          },
        ],
        wantErr: null,
        wantMetricsDelta: {
          writesFinished: 2,
          writesToDbFinished: 2,
        },
      },
      {
        name: 'doBulk error, all retries ok',
        action: async () => await Promise.all([db.set(key, 'v'), db.set(`${key} second op`, 'v')]),
        wantOps: [
          {
            wantFns: ['doBulk'],
            wantMetricsDelta: {
              lockAcquires: 2,
              lockReleases: 2,
              writes: 2,
              writesToDb: 2,
            },
            cbArgs: [[new Error('injected doBulk error')]],
          },
          {
            wantFns: ['set', 'set'],
            wantMetricsDelta: {
              writesToDbRetried: 2,
            },
            cbArgs: [[null], [null]],
          },
        ],
        wantErr: null,
        wantMetricsDelta: {
          writesFinished: 2,
          writesToDbFinished: 2,
        },
      },
      {
        name: 'doBulk error, one of the retries fails',
        action: async () => await Promise.all([db.set(key, 'v'), db.set(`${key} second op`, 'v')]),
        wantOps: [
          {
            wantFns: ['doBulk'],
            wantMetricsDelta: {
              lockAcquires: 2,
              lockReleases: 2,
              writes: 2,
              writesToDb: 2,
            },
            cbArgs: [[new Error('injected doBulk error')]],
          },
          {
            wantFns: ['set', 'set'],
            wantMetricsDelta: {
              writesToDbRetried: 2,
            },
            cbArgs: [[new Error('test')], [null]],
          },
        ],
        wantErr: {message: 'test'},
        wantMetricsDelta: {
          writesFailed: 1,
          writesFinished: 2,
          writesToDbFailed: 1,
          writesToDbFinished: 2,
        },
      },
      {
        name: 'doBulk error, all retries fail',
        action: async () => await Promise.all([db.set(key, 'v'), db.set(`${key} second op`, 'v')]),
        wantOps: [
          {
            wantFns: ['doBulk'],
            wantMetricsDelta: {
              lockAcquires: 2,
              lockReleases: 2,
              writes: 2,
              writesToDb: 2,
            },
            cbArgs: [[new Error('injected doBulk error')]],
          },
          {
            wantFns: ['set', 'set'],
            wantMetricsDelta: {
              writesToDbRetried: 2,
            },
            cbArgs: [[new Error('test1')], [new Error('test2')]],
          },
        ],
        wantErr: (err) => ['test1', 'test2'].includes(err.message),
        wantMetricsDelta: {
          writesFailed: 2,
          writesFinished: 2,
          writesToDbFailed: 2,
          writesToDbFinished: 2,
        },
      },
      {
        name: 'obsoleted ok',
        action: async () => await Promise.all([db.set(key, 'v'), db.set(key, 'v2')]),
        wantOps: [
          {
            wantFns: ['set'],
            wantMetricsDelta: {
              lockAcquires: 2,
              lockAwaits: 1,
              lockReleases: 2,
              writes: 2,
              writesObsoleted: 1,
              writesToDb: 1,
            },
            cbArgs: [[null]],
          },
        ],
        wantErr: null,
        wantMetricsDelta: {
          writesFinished: 2,
          writesToDbFinished: 1,
        },
      },
      {
        name: 'obsoleted error',
        action: async () => await Promise.all([db.set(key, 'v'), db.set(key, 'v2')]),
        wantOps: [
          {
            wantFns: ['set'],
            wantMetricsDelta: {
              lockAcquires: 2,
              lockAwaits: 1,
              lockReleases: 2,
              writes: 2,
              writesObsoleted: 1,
              writesToDb: 1,
            },
            cbArgs: [[new Error('test')]],
          },
        ],
        wantErr: {message: 'test'},
        wantMetricsDelta: {
          writesFailed: 2,
          writesFinished: 2,
          writesToDbFailed: 1,
          writesToDbFinished: 1,
        },
      },
    ];

    for (const tc of tcs) {
      it(tc.name, async function () {
        const opStarts = [];
        for (const fn of ['doBulk', 'get', 'remove', 'set']) {
          mock.on(fn, (...args) => {
            const opStart = opStarts.shift();
            const cb = args.pop();
            opStart.open([fn, cb]);
          });
        }
        let before = {...db.metrics};
        let actionDone;
        // advance() triggers the next database operation(s), either by starting tc.action (if
        // tc.action has not yet been started) or completing the previous operation(s) (if tc.action
        // has been started).
        let advance = () => { actionDone = tc.action(); };
        for (const ops of tc.wantOps) {
          // Provide a way for the mock database to tell us that a mocked database method has been
          // called. The number of expected parallel operations for this iteration is
          // ops.wantFns.length, so that is the number of Gates that are added to opStarts. Each
          // Gate resolves to [fn, cb] where fn is the name of the mocked database method and cb is
          // the mocked database method's callback.
          for (let i = 0; i < ops.wantFns.length; ++i) opStarts.push(new Gate());

          // Trigger the call(s) to the mock database method(s). This is scheduled to run in the
          // future to ensure that advance() does not empty the opStarts array until after the
          // Promise.all() call below has a chance to see all of the Promises in opStarts.
          setImmediate(advance);

          // Wait until the expected number of parallel database method calls have started.
          const gotOps = await Promise.all(opStarts);

          assertMetricsDelta(before, db.metrics, ops.wantMetricsDelta);
          before = {...db.metrics};

          const advanceFns = [];
          for (const [gotFn, cb] of gotOps) {
            const i = ops.wantFns.indexOf(gotFn);
            assert(i >= 0, `unexpected mock database method call: ${gotFn}`);
            ops.wantFns.splice(i, 1);
            const [cbArgs] = ops.cbArgs.splice(i, 1);
            advanceFns.push(() => cb(...cbArgs));
          }
          assert.equal(ops.wantFns.length, 0, `missing call(s): ${ops.wantFns.join(', ')}`);
          advance = () => advanceFns.forEach((f) => f());
        }
        advance();
        await (tc.wantErr ? assert.rejects(actionDone, tc.wantErr) : actionDone);
        assertMetricsDelta(before, db.metrics, tc.wantMetricsDelta);
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
