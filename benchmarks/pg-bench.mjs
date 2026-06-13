import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { timeLoop } from "./lib/timing.mjs";
import { summarize } from "./lib/stats.mjs";

async function loadPgDriver(root) {
  const url = pathToFileURL(path.join(root, "databases", "postgres_db.ts")).href;
  const mod = await import(url);
  if (!mod.default) throw new Error(`postgres_db at ${url} has no default export`);
  return mod.default;
}

// conn: { host, port, user, password, database }
export async function runPgBench(root, conn, opts = {}) {
  const iters = opts.iters ?? 3000;
  const warmup = opts.warmup ?? 300;
  const bulkRounds = opts.bulkRounds ?? 200;
  const bulkBatch = opts.bulkBatch ?? 100;
  const PgDb = await loadPgDriver(root);
  const db = new PgDb({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    database: conn.database,
  });
  const init = promisify(db.init.bind(db));
  const get = promisify(db.get.bind(db));
  const set = promisify(db.set.bind(db));
  const remove = promisify(db.remove.bind(db));
  const findKeys = promisify(db.findKeys.bind(db));
  const doBulk = promisify(db.doBulk.bind(db));
  const close = promisify(db.close.bind(db));

  await init();
  // Start each side from an empty table so rows left by a prior side (both sides
  // share one container) don't bias findKeys/doBulk. The driver exposes the Pool.
  await new Promise((res, rej) => db.db.query("TRUNCATE store", (e) => (e ? rej(e) : res())));
  const val = JSON.stringify({ a: "x".repeat(64), n: 1 });
  const results = {};

  // set (prepared upsert, single-row path).
  results.set = (
    await timeLoop({
      warmup,
      iters,
      fn: async (i) => {
        await set("set:" + i, val);
      },
    })
  ).stats;

  // get (prepared select), keys exist from the set loop.
  results.get = (
    await timeLoop({
      warmup,
      iters,
      fn: async (i) => {
        await get("set:" + (i % iters));
      },
    })
  ).stats;

  // findKeys (LIKE query). Fewer iters: each call scans many rows.
  results.findKeys = (
    await timeLoop({
      warmup: 20,
      iters: 200,
      fn: async () => {
        await findKeys("set:*", null);
      },
    })
  ).stats;

  // doBulk (batched multi-row upsert).
  {
    const durs = [];
    const warmupRounds = 20;
    for (let r = 0; r < bulkRounds + warmupRounds; r++) {
      const ops = [];
      for (let j = 0; j < bulkBatch; j++)
        ops.push({ type: "set", key: `bulk:${r}:${j}`, value: val });
      const t0 = performance.now();
      await doBulk(ops);
      const dt = performance.now() - t0;
      if (r >= warmupRounds) durs.push(dt);
    }
    results.doBulk = summarize(durs);
  }

  // remove (prepared delete), removes the keys written by the set loop.
  results.remove = (
    await timeLoop({
      warmup: 0,
      iters,
      fn: async (i) => {
        await remove("set:" + i);
      },
    })
  ).stats;

  await close();
  return results;
}
