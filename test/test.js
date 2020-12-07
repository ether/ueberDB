'use strict';
/* eslint new-cap: ["error", {"newIsCapExceptions": ["database"]}] */

const Clitable = require('cli-table');
const Randexp = require('randexp');
const assert = require('assert').strict;
const databases = require('./lib/databases').databases;
const fs = require('fs').promises;
const ueberdb = require('../index');
const util = require('util');

describe(__filename, function () {
  let speedTable;

  before(async function () {
    speedTable = new Clitable({
      head: ['Database', '#', 'ms/set', 'ms/get', 'ms/findKeys', 'ms/remove'],
      colWidths: [25, 8, 13, 13, 13, 13],
    });
  });

  after(async function () {
    console.log(speedTable.toString());
  });

  for (const database of Object.keys(databases)) {
    const dbSettings = databases[database];
    describe(database, function () {
      for (const cacheEnabled of [false, true]) {
        const cacheStatus = cacheEnabled ? 'with cache' : 'without cache';
        describe(cacheStatus, function () {
          let db;
          const set = async (db, k, v) => await util.promisify(db.set.bind(db))(k, v, null);
          const get = async (db, k) => await util.promisify(db.get.bind(db))(k);
          const findKeys = async (db, k, nk) => await util.promisify(db.findKeys.bind(db))(k, nk);
          const remove = async (db, k) => await util.promisify(db.remove.bind(db))(k, null);

          before(async function () {
            if (dbSettings.filename) await fs.unlink(dbSettings.filename).catch(() => {});
            db = new ueberdb.database(database, dbSettings);
            await util.promisify(db.init.bind(db))();
            if (!cacheEnabled) db.cache = 0;
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
                  await util.promisify(db.set.bind(db))(key, input);
                });

                it('get(key) -> record', async function () {
                  const output = await util.promisify(db.get.bind(db))(key);
                  assert.equal(JSON.stringify(output), JSON.stringify(input));
                });

                it('get(`${key} `) -> nullish', async function () {
                  const output = await util.promisify(db.get.bind(db))(`${key} `);
                  assert(output == null);
                });

                if (space) {
                  it('get(key.slice(0, -1)) -> nullish', async function () {
                    const output = await util.promisify(db.get.bind(db))(key.slice(0, -1));
                    assert(output == null);
                  });
                }
              });
            }
          });

          it('get of unknown key -> nullish', async function () {
            const key = new Randexp(/.+/).gen();
            assert(await get(db, key) == null);
          });

          it('set+get works', async function () {
            const input = {a: 1, b: new Randexp(/.+/).gen()};
            const key = new Randexp(/.+/).gen();
            await set(db, key, input);
            const output = await get(db, key);
            assert.equal(JSON.stringify(output), JSON.stringify(input));
          });

          it('set+get with random key/value works', async function () {
            const input = {testLongString: new Randexp(/[a-f0-9]{50000}/).gen()};
            const key = new Randexp(/.+/).gen();
            await set(db, key, input);
            const output = await get(db, key);
            assert.equal(JSON.stringify(output), JSON.stringify(input));
          });

          it('findKeys works', async function () {
            const input = {a: 1, b: new Randexp(/.+/).gen()};
            // TODO setting a key with non ascii chars
            const key = new Randexp(/([a-z]\w{0,20})foo\1/).gen();
            await Promise.all([
              set(db, `${key}:test2`, input),
              set(db, `${key}:test`, input),
            ]);
            const output = await findKeys(db, `${key}:*`, null);
            for (const keyVal of output) {
              const output = await get(db, keyVal);
              assert.equal(JSON.stringify(output), JSON.stringify(input));
            }
          });

          it('remove works', async function () {
            const input = {a: 1, b: new Randexp(/.+/).gen()};
            const key = new Randexp(/.+/).gen();
            await set(db, key, input);
            assert.equal(JSON.stringify(await get(db, key)), JSON.stringify(input));
            await remove(db, key);
            assert(await get(db, key) == null);
          });

          it('speed is acceptable', async function () {
            const {speeds: {
              count = 20000,
              getMax = 0.1,
              setMax = 3,
              findKeyMax = 1,
              removeMax = 1,
            } = {}} = dbSettings || {};

            this.timeout(1000000);

            const input = {a: 1, b: new Randexp(/.+/).gen()};
            // TODO setting a key with non ascii chars
            const key = new Randexp(/([a-z]\w{0,20})foo\1/).gen();
            // Pre-allocate an array before starting the timer so that time spent growing the array
            // doesn't throw off the benchmarks.
            const promises = [...Array(count)].map(() => null);

            const timers = {start: Date.now()};

            for (let i = 0; i < count; ++i) promises[i] = set(db, key + i, input);
            await Promise.all(promises);
            timers.set = Date.now();

            for (let i = 0; i < count; ++i) promises[i] = get(db, key + i);
            await Promise.all(promises);
            timers.get = Date.now();

            for (let i = 0; i < count; ++i) promises[i] = findKeys(db, key + i, null);
            await Promise.all(promises);
            timers.findKeys = Date.now();

            for (let i = 0; i < count; ++i) promises[i] = remove(db, key + i);
            await Promise.all(promises);
            timers.remove = Date.now();

            const timePerOp = {
              set: (timers.set - timers.start) / count,
              get: (timers.get - timers.set) / count,
              findKey: (timers.findKeys - timers.get) / count,
              remove: (timers.remove - timers.findKeys) / count,
            };
            speedTable.push([
              `${database} ${cacheStatus}`,
              count,
              timePerOp.set,
              timePerOp.get,
              timePerOp.findKey,
              timePerOp.remove,
            ]);

            const acceptableTable = new Clitable({
              head: ['op', 'Acceptable ms/op', 'Actual ms/op'],
              colWidths: [10, 18, 18],
            });
            acceptableTable.push(
                ['set', setMax, timePerOp.set],
                ['get', getMax, timePerOp.get],
                ['findKey', findKeyMax, timePerOp.findKey],
                ['remove', removeMax, timePerOp.remove]);
            console.log(acceptableTable.toString());

            assert(getMax >= timePerOp.get);
            assert(setMax >= timePerOp.set);
            assert(findKeyMax >= timePerOp.findKey);
            assert(removeMax >= timePerOp.remove);
          });
        });
      }
    });
  }
});

// TODO: Need test which prefills with 1e7 of data then does a get.
