import {deepEqual, rejects} from 'assert';
import es from 'elasticsearch7';
import {databases} from './lib/databases';
import logging from '../lib/logging';
import * as ueberdb from '../index';
'use strict';
const {databases: {elasticsearch: cfg}} = {databases};
const logger = new class extends logging.ConsoleLogger {
  info() { }
  isInfoEnabled() { return false; }
}();

describe(__filename, function (this: any) {
  this.timeout(60000);
  const {base_index = 'ueberdb_test'} = cfg;
  let client: any;
  let db: any;
  beforeEach(async () => {
    client = new es.Client({
      node: `http://${cfg.host || '127.0.0.1'}:${cfg.port || '9200'}`,
    });
    await client.indices.delete({index: `${base_index}*`}, {ignore: [404]});
  });
  afterEach(async () => {
    if (db != null) { await db.close(); }
    db = null;
    await client.indices.delete({index: `${base_index}*`}, {ignore: [404]});
    client.close();
    client = null;
  });
  describe('migration to schema v2', () => {
    describe('no old data', () => {
      for (const migrate of [false, true]) {
        it(`migration ${migrate ? 'en' : 'dis'}abled`, async () => {
          // @ts-ignore
          const settings = {base_index, migrate_to_newer_schema: undefined,
            ...cfg};
          delete settings.migrate_to_newer_schema;
          db = new ueberdb.Database('elasticsearch', settings, {}, logger);
          await db.init();
          const indices = [];
          const {body: res} = await client.indices.get({index: `${base_index}*`});
          for (const [k, v] of Object.entries(res)) {
            indices.push(k);
            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            indices.push(...Object.keys(v.aliases));
          }
          deepEqual(indices.sort(), [`${base_index}_s2`, `${base_index}_s2_i0`].sort());
        });
      }
    });
    describe('existing data', () => {
      // @ts-expect-error TS(2769): No overload matches this call.
      const data = new Map([
        ['foo:number', 42],
        ['foo:string', 'value'],
        ['foo:object', {k: 'v'}],
        ['foo:p:s:number', 42],
        ['foo:p:s:string', 'value'],
        ['foo:p:s:object', {k: 'v'}],
      ]);
      const setOld = async (k: any, v: any) => {
        const kp = k.split(':');
        const index = kp.length === 4 ? `${base_index}-${kp[0]}-${kp[2]}` : base_index;
        await client.index({
          index,
          type: kp.length === 4 ? encodeURIComponent(kp[1]) : kp[0],
          id: kp.length === 4 ? kp[3] : encodeURIComponent(kp[1]),
          body: {
            // The old elasticsearch driver was inconsistent: doBulk() called JSON.parse() on the
            // value from ueberdb before writing, but set() did not. We'll assume that any existing
            // data came from set() writes, not doBulk() writes.
            val: JSON.stringify(v),
          },
        });
        await client.indices.refresh({index});
      };
      beforeEach(async () => {
        await Promise.all([...data].map(async ([k, v]) => await setOld(k, v)));
      });
      it('migration disabled => init error', async () => {
        // @ts-ignore
        const settings = {base_index, migrate_to_newer_schema: undefined,
          ...cfg};
        delete settings.migrate_to_newer_schema;
        db = new ueberdb.Database('elasticsearch', settings, {}, logger);
        await rejects(db.init(), /migrate_to_newer_schema/);
      });
      it('migration enabled', async () => {
        // @ts-ignore
        const settings = {base_index, ...cfg, migrate_to_newer_schema: true};
        db = new ueberdb.Database('elasticsearch', settings, {}, logger);
        await db.init();
        await Promise.all([...data].map(async ([k, v]) => {
          deepEqual(await db.get(k), v);
        }));
      });
      it('each attempt uses a new index', async () => {
        await setOld('a-x:b:c-x:d', 'v'); // Force a conversion failure.
        cfg.base_index = base_index;
        const settings = {...cfg, migrate_to_newer_schema: true};
        db = new ueberdb.Database('elasticsearch', settings, {}, logger);
        const getIndices = async () => Object.keys((await client.indices.get({index: `${base_index}_s2*`})).body);
        deepEqual(await getIndices(), []);
        await rejects(db.init(), /ambig/);
        deepEqual(await getIndices(), [`${base_index}_s2_migrate_attempt_0`]);
        await rejects(db.init(), /ambig/);
        deepEqual((await getIndices()).sort(), [
          `${base_index}_s2_migrate_attempt_0`,
          `${base_index}_s2_migrate_attempt_1`,
        ]);
      });
      it('final name not created until success', async () => {
      });
      describe('ambiguous key', () => {
        for (const k of ['a:b:c-x:d', 'a-x:b:c:d', 'a-x:b:c-x:d']) {
          it(k, async () => {
            await setOld(k, 'v');
            cfg.base_index = base_index;
            const settings = {...cfg, migrate_to_newer_schema: true};
            db = new ueberdb.Database('elasticsearch', settings, {}, logger);
            await rejects(db.init(), /ambig/);
          });
        }
      });
    });
  });
});
