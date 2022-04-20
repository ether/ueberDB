'use strict';

const wtfnode = require('wtfnode'); // This should be first so that it can instrument everything.

const Clitable = require('cli-table');
const Randexp = require('randexp');
const assert = require('assert').strict;
const databases = require('./lib/databases').databases;
const fs = require('fs').promises;
const logging = require('../lib/logging');
const ueberdb = require('../index');

const maxKeyLength = 100;
const randomString = (length = maxKeyLength) => new Randexp(new RegExp(`.{${length}}`)).gen();

// eslint-disable-next-line mocha/no-top-level-hooks
after(async function () {
  // Add a timeout to forcibly exit if something is keeping node from exiting cleanly.
  // The timeout is unref()ed so that it doesn't prevent node from exiting when done.
  setTimeout(() => {
    console.error('node should have exited by now but something is keeping it open ' +
                  'such as an open connection or active timer');
    wtfnode.dump();
    process.exit(1); // eslint-disable-line no-process-exit
  }, 5000).unref();
});

describe(__filename, function () {
  let speedTable;
  let db;

  before(async function () {
    speedTable = new Clitable({
      head: [
        'Database',
        'read cache',
        'write buffer',
        '#',
        'ms/set',
        'ms/get',
        'ms/findKeys',
        'ms/remove',
        'total ms',
        'total ms/#',
      ],
      colWidths: [15, 15, 15, 8, 13, 13, 13, 13, 13, 13],
    });
  });

  after(async function () {
    console.log(speedTable.toString());
  });

  for (const database of Object.keys(databases)) {
    const dbSettings = databases[database];
    describe(database, function () {
      for (const readCache of [false, true]) {
        describe(`${readCache ? '' : 'no '}read cache`, function () {
          for (const writeBuffer of [false, true]) {
            describe(`${writeBuffer ? '' : 'no '}write buffer`, function () {
              this.timeout(5000);

              before(async function () {
                if (dbSettings.filename) await fs.unlink(dbSettings.filename).catch(() => {});
                db = new ueberdb.Database(database, dbSettings, {
                  ...(readCache ? {} : {cache: 0}),
                  ...(writeBuffer ? {} : {writeInterval: 0}),
                }, new logging.ConsoleLogger());
                await db.init();
              });

              after(async function () {
                await db.close();
                if (dbSettings.filename) await fs.unlink(dbSettings.filename).catch(() => {});
              });

              describe('white space in key is not ignored', function () {
                for (const space of [false, true]) {
                  describe(`key ${space ? 'has' : 'does not have'} a trailing space`, function () {
                    let input;
                    let key;

                    before(async function () {
                      input = {a: 1, b: new Randexp(/.+/).gen()};
                      key = randomString(maxKeyLength - 1) + (space ? ' ' : '');
                      await db.set(key, input);
                    });

                    it('get(key) -> record', async function () {
                      const output = await db.get(key);
                      assert.equal(JSON.stringify(output), JSON.stringify(input));
                    });

                    it('get(`${key} `) -> nullish', async function () {
                      const output = await db.get(`${key} `);
                      assert(output == null);
                    });

                    if (space) {
                      it('get(key.slice(0, -1)) -> nullish', async function () {
                        const output = await db.get(key.slice(0, -1));
                        assert(output == null);
                      });
                    }
                  });
                }
              });

              it('get of unknown key -> nullish', async function () {
                const key = randomString();
                assert(await db.get(key) == null);
              });

              it('set+get works', async function () {
                const input = {a: 1, b: new Randexp(/.+/).gen()};
                const key = randomString();
                await db.set(key, input);
                const output = await db.get(key);
                assert.equal(JSON.stringify(output), JSON.stringify(input));
              });

              it('set+get with random key/value works', async function () {
                const input = {testLongString: new Randexp(/[a-f0-9]{50000}/).gen()};
                const key = randomString();
                await db.set(key, input);
                const output = await db.get(key);
                assert.equal(JSON.stringify(output), JSON.stringify(input));
              });

              it('findKeys works', async function () {
                if (database === 'mongodb') this.skip(); // TODO: Fix mongodb.
                // TODO setting a key with non ascii chars
                const key = new Randexp(/([a-z]\w{0,20})foo\1/).gen();
                await Promise.all([
                  db.set(key, true),
                  db.set(`${key}a`, true),
                  db.set(`nonmatching_${key}`, false),
                ]);
                const keys = await db.findKeys(`${key}*`, null);
                assert.deepEqual(keys.sort(), [key, `${key}a`]);
              });

              it('findKeys with exclusion works', async function () {
                if (database === 'mongodb') this.skip(); // TODO: Fix mongodb.
                if (database === 'redis') this.skip(); // TODO: Fix redis.
                const key = new Randexp(/([a-z]\w{0,20})foo\1/).gen();
                await Promise.all([
                  db.set(key, true),
                  db.set(`${key}a`, true),
                  db.set(`${key}b`, false),
                  db.set(`${key}b2`, false),
                  db.set(`nonmatching_${key}`, false),
                ]);
                const keys = await db.findKeys(`${key}*`, `${key}b*`);
                assert.deepEqual(keys.sort(), [key, `${key}a`].sort());
              });

              it('findKeys with no matches works', async function () {
                const key = new Randexp(/([a-z]\w{0,20})foo\1/).gen();
                await db.set(key, true);
                const keys = await db.findKeys(`${key}_nomatch_*`, null);
                assert.deepEqual(keys, []);
              });

              it('findKeys with no wildcard works', async function () {
                const key = new Randexp(/([a-z]\w{0,20})foo\1/).gen();
                await db.set(key, true);
                const keys = await db.findKeys(key, null);
                assert.deepEqual(keys, [key]);
              });

              it('remove works', async function () {
                const input = {a: 1, b: new Randexp(/.+/).gen()};
                const key = randomString();
                await db.set(key, input);
                assert.equal(JSON.stringify(await db.get(key)), JSON.stringify(input));
                await db.remove(key);
                assert(await db.get(key) == null);
              });

              it('getSub of existing property works', async function () {
                await db.set('k', {sub1: {sub2: 'v'}});
                assert.equal(await db.getSub('k', ['sub1', 'sub2']), 'v');
                assert.deepEqual(await db.getSub('k', ['sub1']), {sub2: 'v'});
                assert.deepEqual(await db.getSub('k', []), {sub1: {sub2: 'v'}});
              });

              it('getSub of missing property returns nullish', async function () {
                await db.set('k', {sub1: {}});
                assert(await db.getSub('k', ['sub1', 'sub2']) == null);

                await db.set('k', {});
                assert(await db.getSub('k', ['sub1', 'sub2']) == null);
                assert(await db.getSub('k', ['sub1']) == null);

                await db.remove('k');
                assert(await db.getSub('k', ['sub1', 'sub2']) == null);
                assert(await db.getSub('k', ['sub1']) == null);
                assert(await db.getSub('k', []) == null);
              });

              it('setSub can modify an existing property', async function () {
                await db.set('k', {sub1: {sub2: 'v'}});
                await db.setSub('k', ['sub1', 'sub2'], 'v2');
                assert.deepEqual(await db.get('k'), {sub1: {sub2: 'v2'}});

                await db.setSub('k', ['sub1'], 'v2');
                assert.deepEqual(await db.get('k'), {sub1: 'v2'});

                await db.setSub('k', [], 'v3');
                assert.equal(await db.get('k'), 'v3');
              });

              it('setSub can add a new property', async function () {
                await db.remove('k');
                await db.setSub('k', [], {});
                assert.deepEqual(await db.get('k'), {});
                await db.setSub('k', ['sub1'], {});
                assert.deepEqual(await db.get('k'), {sub1: {}});
                await db.setSub('k', ['sub1', 'sub2'], 'v');
                assert.deepEqual(await db.get('k'), {sub1: {sub2: 'v'}});

                await db.remove('k');
                await db.setSub('k', ['sub1', 'sub2'], 'v');
                assert.deepEqual(await db.get('k'), {sub1: {sub2: 'v'}});
              });

              it('setSub rejects attempts to set properties on primitives', async function () {
                for (const v of ['hello world', 42, true]) {
                  await db.set('k', v);
                  assert.rejects(db.setSub('k', ['sub'], 'x'), {
                    name: 'TypeError',
                    message: /property "sub" on non-object/,
                  });
                  assert.deepEqual(await db.get('k'), v);
                }
              });

              it('speed is acceptable', async function () {
                this.timeout(60000);

                const {speeds: {
                  count = 1000,
                  setMax = 3,
                  getMax = 0.1,
                  findKeysMax = 3,
                  removeMax = 1,
                } = {}} = dbSettings || {};

                const input = {a: 1, b: new Randexp(/.+/).gen()};
                // TODO setting a key with non ascii chars
                const key = new Randexp(/([a-z]\w{0,20})foo\1/).gen();
                // Pre-allocate an array before starting the timer so that time spent growing the
                // array doesn't throw off the benchmarks.
                const promises = [...Array(count + 1)].map(() => null);

                const timers = {start: Date.now()};

                for (let i = 0; i < count; ++i) promises[i] = db.set(key + i, input);
                promises[count] = db.flush();
                await Promise.all(promises);
                timers.set = Date.now();

                for (let i = 0; i < count; ++i) promises[i] = db.get(key + i);
                await Promise.all(promises);
                timers.get = Date.now();

                for (let i = 0; i < count; ++i) promises[i] = db.findKeys(key + i, null);
                await Promise.all(promises);
                timers.findKeys = Date.now();

                for (let i = 0; i < count; ++i) promises[i] = db.remove(key + i);
                promises[count] = db.flush();
                await Promise.all(promises);
                timers.remove = Date.now();

                const timePerOp = {
                  set: (timers.set - timers.start) / count,
                  get: (timers.get - timers.set) / count,
                  findKeys: (timers.findKeys - timers.get) / count,
                  remove: (timers.remove - timers.findKeys) / count,
                };
                speedTable.push([
                  database,
                  readCache ? 'yes' : 'no',
                  writeBuffer ? 'yes' : 'no',
                  count,
                  timePerOp.set,
                  timePerOp.get,
                  timePerOp.findKeys,
                  timePerOp.remove,
                  timers.remove - timers.start,
                  (timers.remove - timers.start) / count,
                ]);

                // Removes the "Acceptable ms/op" column if there is no enforced limit.
                const filterColumn = (row) => {
                  if (readCache && writeBuffer) return row;
                  row.splice(1, 1);
                  return row;
                };
                const acceptableTable = new Clitable({
                  head: filterColumn(['op', 'Acceptable ms/op', 'Actual ms/op']),
                  colWidths: filterColumn([10, 18, 18]),
                });
                acceptableTable.push(...[
                  ['set', setMax, timePerOp.set],
                  ['get', getMax, timePerOp.get],
                  ['findKeys', findKeysMax, timePerOp.findKeys],
                  ['remove', removeMax, timePerOp.remove],
                ].map(filterColumn));
                console.log(acceptableTable.toString());

                if (readCache && writeBuffer) {
                  assert(setMax >= timePerOp.set);
                  assert(getMax >= timePerOp.get);
                  assert(findKeysMax >= timePerOp.findKeys);
                  assert(removeMax >= timePerOp.remove);
                }
              });
            });
          }
        });
      }
    });
  }
});

// TODO: Need test which prefills with 1e7 of data then does a get.
