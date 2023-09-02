// @ts-expect-error TS(7016): Could not find a declaration file for module 'wtfn... Remove this comment to see the full error message
import wtfnode from 'wtfnode';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'cli-... Remove this comment to see the full error message
import Clitable from 'cli-table';
import Randexp from 'randexp-ts';
import {databases} from './lib/databases';
import {promises} from 'fs';
import {ConsoleLogger} from '../lib/logging';
import * as ueberdb from '../index';
import {afterAll, describe, it, afterEach, beforeEach, beforeAll, expect} from 'vitest'
import {rejects} from "assert";

const SURREALDB = process.env.SURREALDB_CI;

const fs = {promises}.promises;
const maxKeyLength = 100;

const randomString = (length = maxKeyLength) => new Randexp(new RegExp(`.{${length}}`)).gen().replace("_","");

// eslint-disable-next-line mocha/no-top-level-hooks
afterAll(async () => {
  // Add a timeout to forcibly exit if something is keeping node from exiting cleanly.
  // The timeout is unref()ed so that it doesn't prevent node from exiting when done.
  setTimeout(() => {
    console.error('node should have exited by now but something is keeping it open ' +
            'such as an open connection or active timer');
    wtfnode.dump();
    process.exit(1); // eslint-disable-line n/no-process-exit
  }, 5000).unref();
});


let databasesToTest: string[] = Object.keys(databases).filter(database=>database !== 'surrealdb');

// test only surrealdb if SURREALDB is set to true
if (SURREALDB && SURREALDB.includes("true")){
  databasesToTest = ["surrealdb"]
}
else if (SURREALDB === undefined) {
  // test every database if unset
    databasesToTest  = Object.keys(databases)
}

describe(__filename, () => {
  let speedTable: any;
  let db: any;
  beforeAll(async () => {
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
  afterAll(async () => {
    console.log(speedTable.toString());
  });
  databasesToTest
      .forEach((database) => {
    const dbSettings = databases[database];
    describe(database, () => {
      for (const readCache of [false, true]) {
        describe(`${readCache ? '' : 'no '}read cache`, () => {
          for (const writeBuffer of [false, true]) {
            describe(`${writeBuffer ? '' : 'no '}write buffer`, function (this: any) {
              beforeEach(async () => {
                if (dbSettings.filename) {
                  await fs.unlink(dbSettings.filename).catch(() => {
                  });
                }
                db = new ueberdb.Database(database, dbSettings, {
                  ...(readCache ? {} : {cache: 0}),
                  ...(writeBuffer ? {} : {writeInterval: 0}),
                }, new ConsoleLogger());
                await db.init();
              });
              afterEach(async () => {
                await db.close();
                if (dbSettings.filename) {
                  await fs.unlink(dbSettings.filename).catch(() => {
                  });
                }
              });
              describe('white space in key is not ignored', () => {
                for (const space of [false, true]) {
                  describe(`key ${space ? 'has' : 'does not have'} a trailing space`, () => {
                    let input: any;
                    let key: any;
                    beforeEach(async () => {
                      input = {a: 1, b: new Randexp(/.+/).gen()};
                      key = randomString(maxKeyLength - 1) + (space ? ' ' : '');
                      await db.set(key, input);
                    });
                    it('get(key) -> record', async (context) => {
                      if(database === 'surrealdb' && space){
                        context.skip()
                      }
                      const output = await db.get(key);
                      expect(JSON.stringify(output)).toBe(JSON.stringify(input));
                    });
                    it('get(`${key} `) -> nullish', async (context) => {
                      if(database === 'surrealdb'  && space){
                        context.skip()
                      }
                      const output = await db.get(`${key} `);
                      console.log("output ",output)
                      expect(output == null).toBeTruthy();
                    });
                    if (space) {
                      it('get(key.slice(0, -1)) -> nullish', async (context) => {
                        if(database === 'surrealdb'  && space){
                          context.skip()
                        }
                        const output = await db.get(key.slice(0, -1));
                        expect(output == null).toBeTruthy();
                      });
                    }
                  });
                }
              });
              it('get of unknown key -> nullish', async () => {
                const key = randomString();
                expect((await db.get(key)) == null).toBeTruthy();
              });
              it('set+get works', async () => {
                const input = {a: 1, b: new Randexp(/.+/).gen()};
                const key = randomString();
                await db.set(key, input);
                const output = await db.get(key);
                expect(JSON.stringify(output)).toBe(JSON.stringify(input));
              });
              it('set+get with random key/value works', async () => {
                const input = {testLongString: new Randexp(/[a-f0-9]{50000}/).gen()};
                const key = randomString();
                await db.set(key, input);
                const output = await db.get(key);
                expect(JSON.stringify(output)).toBe(JSON.stringify(input));
              });
              it('findKeys works', async function (context) {
                if (database === 'mongodb') {
                  context.skip()
                } // TODO: Fix mongodb.
                // TODO setting a key with non ascii chars
                const key = new Randexp(/([a-z]\w{0,20})foo\1/).gen();

                await db.set(key, true)
                await db.set(`${key}a`, true)
                await db.set(`nonmatching_${key}`, false)

                const keys = await db.findKeys(`${key}*`, null);
                expect(keys.sort()).toStrictEqual([key, `${key}a`]);
              });
              it('findKeys with exclusion works', async function (context) {
                if (database === 'mongodb') {
                  context.skip();
                } // TODO: Fix mongodb.
                const key = new Randexp(/([a-z]\w{0,20})foo\1/).gen();

                await db.set(key, true)
                await db.set(`${key}a`, true)
                await db.set(`${key}b`, false)
                await db.set(`${key}b2`, false)
                await db.set(`nonmatching_${key}`, false)
                const keys = await db.findKeys(`${key}*`, `${key}b*`);
                expect(keys.sort()).toStrictEqual([key, `${key}a`]);
              });
              it('findKeys with no matches works', async () => {
                const key = new Randexp(/([a-z]\w{0,20})foo\1/).gen();
                await db.set(key, true);
                const keys = await db.findKeys(`${key}_nomatch_*`, null);
                expect(keys).toStrictEqual([]);
              });
              it('findKeys with no wildcard works', async () => {
                const key = new Randexp(/([a-z]\w{0,20})foo\1/).gen();
                await db.set(key, true);
                const keys = await db.findKeys(key, null);
                expect(keys).toStrictEqual([key]);
              });
              it('remove works', async () => {
                const input = {a: 1, b: new Randexp(/.+/)};
                const key = randomString();
                await db.set(key, input);
                expect(JSON.stringify(await db.get(key))).toStrictEqual(JSON.stringify(input));
                await db.remove(key);
                expect((await db.get(key)) == null).toBeTruthy();
              });
              it('getSub of existing property works', async () => {
                await db.set('k', {sub1: {sub2: 'v'}});
                expect(await db.getSub('k', ['sub1', 'sub2'])).toBe('v');
                expect(await db.getSub('k', ['sub1'])).toStrictEqual({sub2: 'v'});
                expect(await db.getSub('k', [])).toStrictEqual({sub1: {sub2: 'v'}});
              });
              it('getSub of missing property returns nullish', async () => {
                await db.set('k', {sub1: {}});
                expect((await db.getSub('k', ['sub1', 'sub2'])) == null).toBeTruthy();
                await db.set('k', {});
                expect((await db.getSub('k', ['sub1', 'sub2'])) == null).toBeTruthy();
                expect((await db.getSub('k', ['sub1']))).toBeNull();
                await db.remove('k');
                expect((await db.getSub('k', ['sub1', 'sub2'])) == null).toBeTruthy();
                expect((await db.getSub('k', ['sub1'])) == null).toBeTruthy();
                expect(await db.getSub('k', []) == null).toBeTruthy();
              });
              it('setSub can modify an existing property', async () => {
                await db.set('k', {sub1: {sub2: 'v'}});
                await db.setSub('k', ['sub1', 'sub2'], 'v2');
                expect(await db.get('k')).toStrictEqual({sub1: {sub2: 'v2'}});
                await db.setSub('k', ['sub1'], 'v2');
                expect(await db.get('k')).toStrictEqual({sub1: 'v2'});
                await db.setSub('k', [], 'v3');
                expect(await db.get('k')).toStrictEqual('v3');
              });
              it('setSub can add a new property', async () => {
                await db.remove('k');
                await db.setSub('k', [], {});
                expect(await db.get('k')).toStrictEqual({});
                await db.setSub('k', ['sub1'], {});
                expect(await db.get('k')).toStrictEqual({sub1: {}});
                await db.setSub('k', ['sub1', 'sub2'], 'v');
                expect(await db.get('k')).toStrictEqual({sub1: {sub2: 'v'}});
                await db.remove('k');
                await db.setSub('k', ['sub1', 'sub2'], 'v');
                expect(await db.get('k')).toStrictEqual({sub1: {sub2: 'v'}});
              });
              it('setSub rejects attempts to set properties on primitives', async () => {
                for (const v of ['hello world', 42, true]) {
                  await db.set('k', v);
                  await rejects(db.setSub('k', ['sub'], 'x'), {
                    name: 'TypeError',
                    message: /property "sub" on non-object/,
                  });
                  expect(await db.get('k')).toBe(v);
                }
              });
              it('speed is acceptable', async function (context) {
                type TimeSettings = {
                  remove?: string | number;
                  findKeys?: number;
                  get?: number;
                  set?: number;
                  start: number,
                }

                type Speeds = {
                  speeds: {
                    count?: number;
                    setMax?: number;
                    getMax?: number;
                    findKeysMax?: number;
                    removeMax?: number;
                  }
                }

                const {
                  speeds: {
                    count = 1000,
                    setMax = 3,
                    getMax = 0.1,
                    findKeysMax = 3,
                    removeMax = 1
                  } = {}
                }: Speeds = dbSettings || {};
                const input = {a: 1, b: new Randexp(/.+/).gen()};
                // TODO setting a key with non ascii chars
                const key = new Randexp(/([a-z]\w{0,20})foo\1/).gen();
                // Pre-allocate an array before starting the timer so that time spent growing the
                // array doesn't throw off the benchmarks.
                const promises = [...Array(count + 1)].map(() => null);
                const timers: TimeSettings = {start: Date.now()};
                for (let i = 0; i < count; ++i) {
                  promises[i] = db.set(key + i, input);
                }
                promises[count] = db.flush();
                await Promise.all(promises);
                timers.set = Date.now();
                for (let i = 0; i < count; ++i) {
                  promises[i] = db.get(key + i);
                }
                await Promise.all(promises);
                timers.get = Date.now();
                for (let i = 0; i < count; ++i) {
                  promises[i] = db.findKeys(key + i, null);
                }
                await Promise.all(promises);
                timers.findKeys = Date.now();
                for (let i = 0; i < count; ++i) {
                  promises[i] = db.remove(key + i);
                }
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
                const filterColumn = (row: any) => {
                  if (readCache && writeBuffer) {
                    return row;
                  }
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
                  expect(setMax >= timePerOp.set).toBeTruthy();
                  expect(getMax >= timePerOp.get).toBeTruthy();
                  expect(findKeysMax >= timePerOp.findKeys).toBeTruthy();
                  expect(removeMax >= timePerOp.remove).toBeTruthy();
                }
              })
            });
          }
        });
      }
    })})});
