import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { createMemoryBackend } from "./lib/memory-backend.mjs";
import { timeLoop } from "./lib/timing.mjs";
import { summarize } from "./lib/stats.mjs";

const noopLogger = {
  debug() {}, info() {}, warn() {}, error() {},
  isDebugEnabled: () => false, isInfoEnabled: () => false,
  isWarnEnabled: () => false, isErrorEnabled: () => false,
};

const payload = (i) => ({ a: "x".repeat(64), n: i, nested: { b: i % 7, list: [1, 2, 3] } });

async function loadCacheDatabase(root) {
  const url = pathToFileURL(path.join(root, "lib", "CacheAndBufferLayer.ts")).href;
  const mod = await import(url);
  if (!mod.Database) throw new Error(`CacheAndBufferLayer at ${url} has no Database export`);
  return mod.Database;
}

// A buffered set() resolves only when the key is flushed to the backend (set()
// awaits entry.dirty, which flush() settles). So:
//  - set/get/remove benchmarks run UNBUFFERED (writeInterval: 0): each awaited
//    op completes immediately against the in-memory backend, isolating the
//    cache-layer CPU hot paths (cloneIn/cloneOut, lock-free get, dirty Set).
//  - the flush benchmark keeps buffering (writeInterval huge so no auto-flush
//    competes), fires sets WITHOUT awaiting (they only settle on flush), lets
//    them buffer, then times the explicit flush() that drains them.
// remove(key) is set(key, null) internally, so it also needs UNBUFFERED mode.
const NO_AUTO_FLUSH = 3_600_000;

export async function runCacheBench(root, opts = {}) {
  const iters = opts.iters ?? 100_000;
  const warmup = opts.warmup ?? 10_000;
  const bulkRounds = opts.bulkRounds ?? 200;
  const bulkBatch = opts.bulkBatch ?? 500;
  const Database = await loadCacheDatabase(root);
  const nextTick = () => new Promise((r) => setImmediate(r));
  const results = {};

  // set (unbuffered): exercises cloneIn + buffer insert + dirty tracking.
  {
    const db = new Database(createMemoryBackend(), { cache: iters + warmup + 10, writeInterval: 0 }, noopLogger);
    await db.init();
    results.set = (await timeLoop({ warmup, iters, fn: async (i) => { await db.set("set:" + i, payload(i)); } })).stats;
    await db.close();
  }

  // get (cache hit): prefill (unbuffered) + a priming read pass to populate the
  // cache, then time get() served from the buffer (lock-free fast path + cloneOut).
  {
    const db = new Database(createMemoryBackend(), { cache: iters + 10, writeInterval: 0 }, noopLogger);
    await db.init();
    for (let i = 0; i < iters; i++) await db.set("hit:" + i, payload(i));
    for (let i = 0; i < iters; i++) await db.get("hit:" + i);
    const cacheReadsBefore = db.metrics.readsFromCache;
    results.getHit = (await timeLoop({ warmup, iters, fn: async (i) => { await db.get("hit:" + (i % iters)); } })).stats;
    if (db.metrics.readsFromCache <= cacheReadsBefore) {
      throw new Error("cache-hit benchmark did not exercise the readsFromCache path");
    }
    await db.close();
  }

  // get (cache miss): keys never written -> read falls through to the backend.
  {
    const db = new Database(createMemoryBackend(), { cache: 1000, writeInterval: 0 }, noopLogger);
    await db.init();
    results.getMiss = (await timeLoop({ warmup, iters, fn: async (i) => { await db.get("miss:" + i); } })).stats;
    await db.close();
  }

  // remove (unbuffered): prefill keys, then remove each once.
  {
    const db = new Database(createMemoryBackend(), { cache: iters + 10, writeInterval: 0 }, noopLogger);
    await db.init();
    for (let i = 0; i < iters; i++) await db.set("rm:" + i, payload(i));
    results.remove = (await timeLoop({ warmup: 0, iters, fn: async (i) => { await db.remove("rm:" + i); } })).stats;
    await db.close();
  }

  // flush (bulk drain): buffer `bulkBatch` dirty keys, then time flush() draining
  // them. Sets are fired WITHOUT awaiting (a buffered set settles only on flush);
  // nextTick() lets them all buffer; the set promises are settled after flush.
  {
    const db = new Database(createMemoryBackend(), { cache: bulkBatch * 4, writeInterval: NO_AUTO_FLUSH }, noopLogger);
    await db.init();
    const durs = [];
    const warmupRounds = 20;
    for (let r = 0; r < bulkRounds + warmupRounds; r++) {
      const ps = [];
      for (let j = 0; j < bulkBatch; j++) ps.push(db.set(`bulk:${r}:${j}`, payload(j)));
      await nextTick();
      const t0 = performance.now();
      await db.flush();
      const dt = performance.now() - t0;
      await Promise.all(ps);
      if (r >= warmupRounds) durs.push(dt);
    }
    results.flush = summarize(durs);
    await db.close();
  }

  return results;
}
