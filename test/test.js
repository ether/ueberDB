'use strict';

const wtfnode = require('wtfnode'); // This should be first so that it can instrument everything.

const Clitable = require('cli-table');
const Randexp = require('randexp');
const assert = require('assert').strict;
const databases = require('./lib/databases').databases;
const fs = require('fs').promises;
const ueberdb = require('../index');
const util = require('util');

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
  let get, findKeys, set, remove, flush;

  before(async function () {
    speedTable = new Clitable({
      head: [
        'Database',
        '#',
        'ms/set',
        'ms/get',
        'ms/findKeys',
        'ms/remove',
        'total ms',
        'total ms/#',
      ],
      colWidths: [25, 8, 13, 13, 13, 13, 13, 13],
    });
  });

  after(async function () {
    console.log(speedTable.toString());
  });

  for (const database of Object.keys(databases)) {
    const dbSettings = databases[database];
    describe(database, function () {
      for (const readCache of [false, true]) {
        const readCacheStatus = `${readCache ? '' : 'no '}read cache`;
        describe(readCacheStatus, function () {
          before(async function () {
            if (dbSettings.filename) await fs.unlink(dbSettings.filename).catch(() => {});
            db = new ueberdb.Database(database, dbSettings, readCache ? {} : {cache: 0});
            await util.promisify(db.init.bind(db))();
            get = util.promisify(db.get.bind(db));
            findKeys = util.promisify(db.findKeys.bind(db));
            set = (k, v) => {
              let bp;
              const wp = new Promise((resolve, reject) => {
                const wCb = (err) => { if (err != null) return reject(err); resolve(); };
                bp = new Promise((resolve, reject) => {
                  const bCb = (err) => { if (err != null) return reject(err); resolve(); };
                  db.set(k, v, bCb, wCb);
                });
              });
              wp.buffered = bp;
              return wp;
            };
            remove = (k) => {
              let bp;
              const wp = new Promise((resolve, reject) => {
                const wCb = (err) => { if (err != null) return reject(err); resolve(); };
                bp = new Promise((resolve, reject) => {
                  const bCb = (err) => { if (err != null) return reject(err); resolve(); };
                  db.remove(k, bCb, wCb);
                });
              });
              wp.buffered = bp;
              return wp;
            };
            // TODO: Add a flush() method to ueberdb.Database.
            flush = util.promisify(db.db.flush.bind(db.db));
          });

          after(async function () {
            await util.promisify(db.doShutdown.bind(db))();
            await util.promisify(db.close.bind(db))();
            if (dbSettings.filename) await fs.unlink(dbSettings.filename).catch(() => {});
          });

          describe('white space in key is not ignored', function () {
            for (const space of [false, true]) {
              describe(`key ${space ? 'has' : 'does not have'} a trailing space`, function () {
                let input;
                let key;

                before(async function () {
                  input = {a: 1, b: new Randexp(/.+/).gen()};
                  key = new Randexp(/.+/).gen() + (space ? ' ' : '');
                  await set(key, input);
                });

                it('get(key) -> record', async function () {
                  const output = await get(key);
                  assert.equal(JSON.stringify(output), JSON.stringify(input));
                });

                it('get(`${key} `) -> nullish', async function () {
                  const output = await get(`${key} `);
                  assert(output == null);
                });

                if (space) {
                  it('get(key.slice(0, -1)) -> nullish', async function () {
                    const output = await get(key.slice(0, -1));
                    assert(output == null);
                  });
                }
              });
            }
          });

          it('get of unknown key -> nullish', async function () {
            const key = new Randexp(/.+/).gen();
            assert(await get(key) == null);
          });

          it('set+get works', async function () {
            const input = {a: 1, b: new Randexp(/.+/).gen()};
            const key = new Randexp(/.+/).gen();
            await set(key, input);
            const output = await get(key);
            assert.equal(JSON.stringify(output), JSON.stringify(input));
          });

          it('set+get with random key/value works', async function () {
            const input = {testLongString: new Randexp(/[a-f0-9]{50000}/).gen()};
            const key = new Randexp(/.+/).gen();
            await set(key, input);
            const output = await get(key);
            assert.equal(JSON.stringify(output), JSON.stringify(input));
          });

          it('findKeys works', async function () {
            const input = {a: 1, b: new Randexp(/.+/).gen()};
            // TODO setting a key with non ascii chars
            const key = new Randexp(/([a-z]\w{0,20})foo\1/).gen();
            await Promise.all([
              set(`${key}:test2`, input),
              set(`${key}:test`, input),
            ]);
            const output = await findKeys(`${key}:*`, null);
            for (const keyVal of output) {
              const output = await get(keyVal);
              assert.equal(JSON.stringify(output), JSON.stringify(input));
            }
          });

          it('remove works', async function () {
            const input = {a: 1, b: new Randexp(/.+/).gen()};
            const key = new Randexp(/.+/).gen();
            await set(key, input);
            assert.equal(JSON.stringify(await get(key)), JSON.stringify(input));
            await remove(key);
            assert(await get(key) == null);
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
            // Pre-allocate an array before starting the timer so that time spent growing the array
            // doesn't throw off the benchmarks.
            const promises = [...Array(count + 1)].map(() => null);
            const bufferedPromises = [...Array(count)].map(() => null);

            const timers = {start: Date.now()};

            for (let i = 0; i < count; ++i) {
              promises[i] = set(key + i, input);
              bufferedPromises[i] = promises[i].buffered;
            }
            await Promise.all(bufferedPromises);
            promises[count] = flush();
            await Promise.all(promises);
            timers.set = Date.now();

            for (let i = 0; i < count; ++i) promises[i] = get(key + i);
            await Promise.all(promises);
            timers.get = Date.now();

            for (let i = 0; i < count; ++i) promises[i] = findKeys(key + i, null);
            await Promise.all(promises);
            timers.findKeys = Date.now();

            for (let i = 0; i < count; ++i) {
              promises[i] = remove(key + i);
              bufferedPromises[i] = promises[i].buffered;
            }
            await Promise.all(bufferedPromises);
            promises[count] = flush();
            await Promise.all(promises);
            timers.remove = Date.now();

            const timePerOp = {
              set: (timers.set - timers.start) / count,
              get: (timers.get - timers.set) / count,
              findKeys: (timers.findKeys - timers.get) / count,
              remove: (timers.remove - timers.findKeys) / count,
            };
            speedTable.push([
              `${database} ${readCacheStatus}`,
              count,
              timePerOp.set,
              timePerOp.get,
              timePerOp.findKeys,
              timePerOp.remove,
              timers.remove - timers.start,
              (timers.remove - timers.start) / count,
            ]);

            const acceptableTable = new Clitable({
              head: ['op', 'Acceptable ms/op', 'Actual ms/op'],
              colWidths: [10, 18, 18],
            });
            acceptableTable.push(
                ['set', setMax, timePerOp.set],
                ['get', getMax, timePerOp.get],
                ['findKeys', findKeysMax, timePerOp.findKeys],
                ['remove', removeMax, timePerOp.remove]);
            console.log(acceptableTable.toString());

            assert(setMax >= timePerOp.set);
            assert(getMax >= timePerOp.get);
            assert(findKeysMax >= timePerOp.findKeys);
            assert(removeMax >= timePerOp.remove);
          });
        });
      }
    });
  }
});

// TODO: Need test which prefills with 1e7 of data then does a get.
