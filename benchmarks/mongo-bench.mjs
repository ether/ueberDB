import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { timeLoop } from "./lib/timing.mjs";
import { summarize } from "./lib/stats.mjs";

async function loadMongoDriver(root) {
  const url = pathToFileURL(path.join(root, "databases", "mongodb_db.ts")).href;
  const mod = await import(url);
  if (!mod.default) throw new Error(`mongodb_db at ${url} has no default export`);
  return mod.default;
}

// conn: { url, database }
export async function runMongoBench(root, conn, opts = {}) {
  const iters = opts.iters ?? 3000;
  const warmup = opts.warmup ?? 300;
  const bulkRounds = opts.bulkRounds ?? 200;
  const bulkBatch = opts.bulkBatch ?? 100;
  const MongoDb = await loadMongoDriver(root);
  const db = new MongoDb({ url: conn.url, database: conn.database, collection: "ueberdb_bench" });
  const init = promisify(db.init.bind(db));
  const get = promisify(db.get.bind(db));
  const set = promisify(db.set.bind(db));
  const remove = promisify(db.remove.bind(db));
  const findKeys = promisify(db.findKeys.bind(db));
  const doBulk = promisify(db.doBulk.bind(db));
  const close = promisify(db.close.bind(db));

  await init();
  // Start each side from an empty collection so docs left by a prior side (both
  // sides share one container) don't bias findKeys/doBulk. Driver exposes it.
  await db.collection.deleteMany({});
  const val = JSON.stringify({ a: "x".repeat(64), n: 1 });
  const results = {};

  results.set = (await timeLoop({ warmup, iters, fn: async (i) => { await set("set:" + i, val); } })).stats;
  results.get = (await timeLoop({ warmup, iters, fn: async (i) => { await get("set:" + (i % iters)); } })).stats;
  results.findKeys = (await timeLoop({ warmup: 20, iters: 200, fn: async () => { await findKeys("set:*", null); } })).stats;

  {
    const durs = [];
    const warmupRounds = 20;
    for (let r = 0; r < bulkRounds + warmupRounds; r++) {
      const ops = [];
      for (let j = 0; j < bulkBatch; j++) ops.push({ type: "set", key: `bulk:${r}:${j}`, value: val });
      const t0 = performance.now();
      await doBulk(ops);
      const dt = performance.now() - t0;
      if (r >= warmupRounds) durs.push(dt);
    }
    results.doBulk = summarize(durs);
  }

  results.remove = (await timeLoop({ warmup: 0, iters, fn: async (i) => { await remove("set:" + i); } })).stats;

  await close();
  return results;
}
