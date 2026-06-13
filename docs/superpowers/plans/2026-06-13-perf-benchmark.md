# Perf Benchmark (before vs after) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained benchmark harness that compares ueberDB's
performance at `809bcc2` (before the three perf commits) vs `HEAD`, across the
cache layer, the Postgres driver, and the Mongo driver, and renders the result
as an offline HTML chart.

**Architecture:** Plain ESM JavaScript (`.mjs`) harness in `benchmarks/`,
run on Node ≥24. It deep-imports the library's `.ts` **source** (Node strips
types at runtime; relative imports in these files are type-only and erased) from
two tree roots — the current tree (`after`) and a `git worktree` at `809bcc2`
(`before`) — so no build step is needed. The cache commit is measured by
constructing `CacheAndBufferLayer`'s `Database` around a harness-local in-memory
`Map` backend; the driver commits are measured by calling the driver classes
directly against dockerized Postgres/Mongo started via `testcontainers`.
Timings use `performance.now()` with warmup; results render as hand-rolled
inline `<svg>` bars plus a delta table.

**Tech Stack:** Node ≥24 ESM (type-stripping), `node:test` (unit tests),
`node:perf_hooks`, `node:util.promisify`, `testcontainers` (already a devDep),
`pg`/`mongodb`/`async` (peer deps installed per worktree).

---

## File Structure

- `benchmarks/lib/stats.mjs` — pure stats: `mean/median/min/percentile/opsPerSec/percentDelta/summarize`.
- `benchmarks/lib/stats.test.mjs` — `node:test` unit tests for stats.
- `benchmarks/lib/timing.mjs` — `timeLoop({warmup, iters, fn})` measured loop.
- `benchmarks/lib/timing.test.mjs` — `node:test` for `timeLoop`.
- `benchmarks/lib/memory-backend.mjs` — harness-local async `Map` backend with `doBulk`.
- `benchmarks/cache-bench.mjs` — cache-layer workload (deep-imports `CacheAndBufferLayer.ts`).
- `benchmarks/pg-bench.mjs` — Postgres driver-direct workload.
- `benchmarks/mongo-bench.mjs` — Mongo driver-direct workload.
- `benchmarks/harness.mjs` — per-side entry; reads env, runs targets, writes `out/<label>.json`.
- `benchmarks/render.mjs` — merges `out/before.json` + `out/after.json` → `results.html` + `results.json`.
- `benchmarks/render.test.mjs` — `node:test` for the pure render function.
- `benchmarks/run.mjs` — orchestrator (worktree, containers, run x2, render, teardown).
- `benchmarks/README.md` — how to run.
- `benchmarks/out/.gitkeep` — output dir (per-side JSON, gitignored except keep).
- `benchmarks/.gitignore` — ignore `out/*.json`.

Each `.mjs` has one responsibility; pure logic (stats, render) is isolated from
I/O (benches, orchestrator) so it can be unit-tested without docker.

---

## Task 1: Scaffold + stats library (TDD)

**Files:**

- Create: `benchmarks/lib/stats.mjs`
- Test: `benchmarks/lib/stats.test.mjs`
- Create: `benchmarks/.gitignore`
- Create: `benchmarks/out/.gitkeep`

- [ ] **Step 1: Write the failing test**

Create `benchmarks/lib/stats.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mean, median, min, percentile, opsPerSec, percentDelta, summarize } from "./stats.mjs";

test("mean/median/min on a simple set", () => {
  const xs = [10, 20, 30, 40];
  assert.equal(mean(xs), 25);
  assert.equal(median(xs), 20); // p50 -> ceil(0.5*4)-1 = idx 1 = 20
  assert.equal(min(xs), 10);
});

test("percentile picks the nearest-rank sample", () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(xs, 95), 10);
  assert.equal(percentile(xs, 50), 5);
});

test("empty inputs are zero, not NaN", () => {
  assert.equal(mean([]), 0);
  assert.equal(min([]), 0);
  assert.equal(percentile([], 95), 0);
});

test("opsPerSec converts mean ms to ops/sec", () => {
  assert.equal(opsPerSec(1), 1000);
  assert.equal(opsPerSec(0), 0);
});

test("percentDelta is positive when after is faster (higher ops/sec)", () => {
  assert.equal(percentDelta(100, 150), 50);
  assert.equal(percentDelta(0, 10), 0);
});

test("summarize returns the full shape from samples", () => {
  const s = summarize([2, 2, 2, 2]);
  assert.equal(s.n, 4);
  assert.equal(s.meanMs, 2);
  assert.equal(s.medianMs, 2);
  assert.equal(s.minMs, 2);
  assert.equal(s.p95Ms, 2);
  assert.equal(s.opsPerSec, 500);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test benchmarks/lib/stats.test.mjs`
Expected: FAIL — `Cannot find module './stats.mjs'`.

- [ ] **Step 3: Write minimal implementation**

Create `benchmarks/lib/stats.mjs`:

```js
// Pure statistics helpers. No I/O. All functions tolerate empty arrays.

export const sum = (xs) => {
  let t = 0;
  for (let i = 0; i < xs.length; i++) t += xs[i];
  return t;
};

export const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);

export const min = (xs) => {
  if (!xs.length) return 0;
  let m = xs[0];
  for (let i = 1; i < xs.length; i++) if (xs[i] < m) m = xs[i];
  return m;
};

// Nearest-rank percentile (1..100). Sorts a copy.
export const percentile = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
};

export const median = (xs) => percentile(xs, 50);

// ops/sec from mean milliseconds-per-op.
export const opsPerSec = (meanMs) => (meanMs > 0 ? 1000 / meanMs : 0);

// Percent change of `after` relative to `before`. Positive = after larger.
// Used on ops/sec, where larger is faster, so positive = improvement.
export const percentDelta = (before, after) =>
  before === 0 ? 0 : ((after - before) / before) * 100;

export const summarize = (samplesMs) => {
  const m = mean(samplesMs);
  return {
    n: samplesMs.length,
    meanMs: m,
    medianMs: median(samplesMs),
    minMs: min(samplesMs),
    p95Ms: percentile(samplesMs, 95),
    opsPerSec: opsPerSec(m),
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test benchmarks/lib/stats.test.mjs`
Expected: PASS — all 6 tests pass.

- [ ] **Step 5: Add scaffolding files**

Create `benchmarks/.gitignore`:

```gitignore
out/*.json
results.html
results.json
```

Create `benchmarks/out/.gitkeep` (empty file).

- [ ] **Step 6: Commit**

```bash
git add benchmarks/lib/stats.mjs benchmarks/lib/stats.test.mjs benchmarks/.gitignore benchmarks/out/.gitkeep
git commit -m "feat(bench): pure stats helpers + benchmarks scaffold"
```

---

## Task 2: Measured timing loop (TDD)

**Files:**

- Create: `benchmarks/lib/timing.mjs`
- Test: `benchmarks/lib/timing.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `benchmarks/lib/timing.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { timeLoop } from "./timing.mjs";

test("runs warmup + iters times and returns a stats summary", async () => {
  let calls = 0;
  const { stats } = await timeLoop({
    warmup: 3,
    iters: 10,
    fn: async () => {
      calls++;
    },
  });
  assert.equal(calls, 13); // warmup + measured
  assert.equal(stats.n, 10); // only measured iters counted
  assert.ok(stats.meanMs >= 0);
  assert.ok(stats.opsPerSec >= 0);
});

test("passes the iteration index to fn", async () => {
  const seen = [];
  await timeLoop({
    warmup: 0,
    iters: 4,
    fn: async (i) => {
      seen.push(i);
    },
  });
  assert.deepEqual(seen, [0, 1, 2, 3]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test benchmarks/lib/timing.test.mjs`
Expected: FAIL — `Cannot find module './timing.mjs'`.

- [ ] **Step 3: Write minimal implementation**

Create `benchmarks/lib/timing.mjs`:

```js
import { performance } from "node:perf_hooks";
import { summarize } from "./stats.mjs";

// Runs `fn(i)` `warmup` times (discarded) then `iters` times (measured).
// `fn` is async; each measured call is timed individually with performance.now().
// Returns { stats } where stats is summarize() over the per-iteration ms samples.
export async function timeLoop({ warmup = 0, iters, fn }) {
  for (let i = 0; i < warmup; i++) await fn(i);
  const samples = new Array(iters);
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    await fn(i);
    samples[i] = performance.now() - t0;
  }
  return { stats: summarize(samples) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test benchmarks/lib/timing.test.mjs`
Expected: PASS — both tests pass.

- [ ] **Step 5: Commit**

```bash
git add benchmarks/lib/timing.mjs benchmarks/lib/timing.test.mjs
git commit -m "feat(bench): measured timing loop with warmup"
```

---

## Task 3: In-memory backend for the cache target

**Files:**

- Create: `benchmarks/lib/memory-backend.mjs`

This backend stands in for a real DB under `CacheAndBufferLayer`. It is async
(`isAsync === true`, so the cache layer uses it without promisifying) and
implements `doBulk` (which the cache flush path requires — the real `memory`
backend does not, which is why we don't use it).

- [ ] **Step 1: Write the backend**

Create `benchmarks/lib/memory-backend.mjs`:

```js
// Minimal async key/value backend backed by a Map, for benchmarking the
// CacheAndBufferLayer in isolation. Mirrors the method surface the cache layer
// expects from an async wrapped DB.

// Matches AbstractDatabase.createFindRegex semantics closely enough for bench.
const globToRegExp = (key, notKey) => {
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  let re = `^(?=${esc(key)}$)`;
  if (notKey != null) re += `(?!${esc(notKey)}$)`;
  return new RegExp(re);
};

export function createMemoryBackend() {
  const data = new Map();
  return {
    _data: data,
    get isAsync() {
      return true;
    },
    settings: {},
    logger: undefined,
    async init() {},
    async close() {
      data.clear();
    },
    async get(key) {
      return data.get(key);
    },
    async set(key, value) {
      data.set(key, value);
    },
    async remove(key) {
      data.delete(key);
    },
    async findKeys(key, notKey) {
      const re = globToRegExp(key, notKey);
      const out = [];
      for (const k of data.keys()) if (re.test(k)) out.push(k);
      return out;
    },
    async findKeysPaged(key, notKey, options) {
      const all = (await this.findKeys(key, notKey)).sort();
      const after = options?.after;
      const start = after != null ? all.findIndex((k) => k > after) : 0;
      const from = start < 0 ? all.length : start;
      return all.slice(from, from + (options?.limit ?? all.length));
    },
    async doBulk(ops) {
      for (const op of ops) {
        if (op.type === "set") data.set(op.key, op.value);
        else if (op.type === "remove") data.delete(op.key);
      }
    },
  };
}
```

- [ ] **Step 2: Smoke-check it loads and behaves**

Run:

```bash
node --input-type=module -e "import('./benchmarks/lib/memory-backend.mjs').then(async ({createMemoryBackend})=>{const b=createMemoryBackend();await b.init();await b.set('a:1','x');await b.doBulk([{type:'set',key:'a:2',value:'y'},{type:'remove',key:'a:1'}]);console.log(await b.get('a:2'), await b.findKeys('a:*'));})"
```

Expected: prints `y [ 'a:2' ]`.

- [ ] **Step 3: Commit**

```bash
git add benchmarks/lib/memory-backend.mjs
git commit -m "feat(bench): async in-memory backend with doBulk for cache target"
```

---

## Task 4: Cache-layer benchmark

**Files:**

- Create: `benchmarks/cache-bench.mjs`

Deep-imports `CacheAndBufferLayer.ts` from the tree root under test (Node strips
types at import). Measures `set`, `get` (cache hit), `get` (cache miss),
`remove`, and `flush` (bulk drain). Asserts the cache-hit path is actually
exercised via `metrics.readsFromCache`.

- [ ] **Step 1: Write the benchmark module**

Create `benchmarks/cache-bench.mjs`:

```js
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { createMemoryBackend } from "./lib/memory-backend.mjs";
import { timeLoop } from "./lib/timing.mjs";
import { summarize } from "./lib/stats.mjs";

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  isDebugEnabled: () => false,
  isInfoEnabled: () => false,
  isWarnEnabled: () => false,
  isErrorEnabled: () => false,
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
    const db = new Database(
      createMemoryBackend(),
      { cache: iters + warmup + 10, writeInterval: 0 },
      noopLogger,
    );
    await db.init();
    results.set = (
      await timeLoop({
        warmup,
        iters,
        fn: async (i) => {
          await db.set("set:" + i, payload(i));
        },
      })
    ).stats;
    await db.close();
  }

  // get (cache hit): prefill (unbuffered) + a priming read pass to populate the
  // cache, then time get() served from the buffer (lock-free fast path + cloneOut).
  {
    const db = new Database(
      createMemoryBackend(),
      { cache: iters + 10, writeInterval: 0 },
      noopLogger,
    );
    await db.init();
    for (let i = 0; i < iters; i++) await db.set("hit:" + i, payload(i));
    for (let i = 0; i < iters; i++) await db.get("hit:" + i);
    const cacheReadsBefore = db.metrics.readsFromCache;
    results.getHit = (
      await timeLoop({
        warmup,
        iters,
        fn: async (i) => {
          await db.get("hit:" + (i % iters));
        },
      })
    ).stats;
    if (db.metrics.readsFromCache <= cacheReadsBefore) {
      throw new Error("cache-hit benchmark did not exercise the readsFromCache path");
    }
    await db.close();
  }

  // get (cache miss): keys never written -> read falls through to the backend.
  {
    const db = new Database(createMemoryBackend(), { cache: 1000, writeInterval: 0 }, noopLogger);
    await db.init();
    results.getMiss = (
      await timeLoop({
        warmup,
        iters,
        fn: async (i) => {
          await db.get("miss:" + i);
        },
      })
    ).stats;
    await db.close();
  }

  // remove (unbuffered): prefill keys, then remove each once.
  {
    const db = new Database(
      createMemoryBackend(),
      { cache: iters + 10, writeInterval: 0 },
      noopLogger,
    );
    await db.init();
    for (let i = 0; i < iters; i++) await db.set("rm:" + i, payload(i));
    results.remove = (
      await timeLoop({
        warmup: 0,
        iters,
        fn: async (i) => {
          await db.remove("rm:" + i);
        },
      })
    ).stats;
    await db.close();
  }

  // flush (bulk drain): buffer `bulkBatch` dirty keys, then time flush() draining
  // them. Sets are fired WITHOUT awaiting (a buffered set settles only on flush);
  // nextTick() lets them all buffer; the set promises are settled after flush.
  {
    const db = new Database(
      createMemoryBackend(),
      { cache: bulkBatch * 4, writeInterval: NO_AUTO_FLUSH },
      noopLogger,
    );
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
```

**Note (validated):** a buffered `set()` only resolves when flushed, so awaiting
each set under a long `writeInterval` deadlocks. The unbuffered-vs-flush split
above was verified against the live source before this plan revision.

- [ ] **Step 2: Verify against the current (after) tree**

Run (small iters so it's fast):

```bash
node --input-type=module -e "import('./benchmarks/cache-bench.mjs').then(async ({runCacheBench})=>{const r=await runCacheBench(process.cwd(),{iters:2000,warmup:200,bulkRounds:20,bulkBatch:50});console.log(JSON.stringify(Object.fromEntries(Object.entries(r).map(([k,v])=>[k,Math.round(v.opsPerSec)])),null,2));})"
```

Expected: prints an object with positive ops/sec for `set`, `getHit`, `getMiss`,
`remove`, `flush`, and does NOT throw the "readsFromCache" error.

- [ ] **Step 3: Commit**

```bash
git add benchmarks/cache-bench.mjs
git commit -m "feat(bench): cache-layer benchmark via CacheAndBufferLayer source"
```

---

## Task 5: Postgres driver benchmark

**Files:**

- Create: `benchmarks/pg-bench.mjs`

Deep-imports `databases/postgres_db.ts` (default export) from the tree root,
promisifies its callback methods, and measures `set`, `get`, `findKeys`,
`doBulk` (batched), and `remove` against a live Postgres.

- [ ] **Step 1: Write the benchmark module**

Create `benchmarks/pg-bench.mjs`:

```js
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
```

- [ ] **Step 2: Defer live verification to Task 8**

The orchestrator (Task 8) starts Postgres and runs this. No standalone run here
(it needs a container). Verify only that the module imports cleanly:

Run: `node --check benchmarks/pg-bench.mjs && echo "syntax ok"`
Expected: prints `syntax ok`.

- [ ] **Step 3: Commit**

```bash
git add benchmarks/pg-bench.mjs
git commit -m "feat(bench): postgres driver benchmark (set/get/findKeys/doBulk/remove)"
```

---

## Task 6: Mongo driver benchmark

**Files:**

- Create: `benchmarks/mongo-bench.mjs`

- [ ] **Step 1: Write the benchmark module**

Create `benchmarks/mongo-bench.mjs`:

```js
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
  const val = JSON.stringify({ a: "x".repeat(64), n: 1 });
  const results = {};

  results.set = (
    await timeLoop({
      warmup,
      iters,
      fn: async (i) => {
        await set("set:" + i, val);
      },
    })
  ).stats;
  results.get = (
    await timeLoop({
      warmup,
      iters,
      fn: async (i) => {
        await get("set:" + (i % iters));
      },
    })
  ).stats;
  results.findKeys = (
    await timeLoop({
      warmup: 20,
      iters: 200,
      fn: async () => {
        await findKeys("set:*", null);
      },
    })
  ).stats;

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
```

- [ ] **Step 2: Syntax check**

Run: `node --check benchmarks/mongo-bench.mjs && echo "syntax ok"`
Expected: prints `syntax ok`.

- [ ] **Step 3: Commit**

```bash
git add benchmarks/mongo-bench.mjs
git commit -m "feat(bench): mongo driver benchmark (set/get/findKeys/doBulk/remove)"
```

---

## Task 7: Render (TDD) — merge + self-contained HTML

**Files:**

- Create: `benchmarks/render.mjs`
- Test: `benchmarks/render.test.mjs`

`render.mjs` exposes a pure `renderHtml(before, after)` (testable) plus a CLI
entry that reads `out/before.json` + `out/after.json` and writes `results.html`
and `results.json`. Charts are hand-rolled inline `<svg>` bars (no external
resources).

- [ ] **Step 1: Write the failing test**

Create `benchmarks/render.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHtml, buildRows } from "./render.mjs";

const before = {
  label: "before",
  targets: { cache: { set: { opsPerSec: 100, medianMs: 10, p95Ms: 12 } } },
};
const after = {
  label: "after",
  targets: { cache: { set: { opsPerSec: 150, medianMs: 6, p95Ms: 7 } } },
};

test("buildRows computes per-op before/after/delta", () => {
  const rows = buildRows("cache", before, after);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].op, "set");
  assert.equal(rows[0].before, 100);
  assert.equal(rows[0].after, 150);
  assert.equal(Math.round(rows[0].deltaPct), 50);
});

test("renderHtml is a self-contained document with svg + table + the op label", () => {
  const html = renderHtml(before, after);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<svg/);
  assert.match(html, /<table/);
  assert.match(html, /set/);
  assert.match(html, /\+50/); // delta rendered with sign
  assert.doesNotMatch(html, /https?:\/\//); // no external resources
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test benchmarks/render.test.mjs`
Expected: FAIL — `Cannot find module './render.mjs'`.

- [ ] **Step 3: Write minimal implementation**

Create `benchmarks/render.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { percentDelta } from "./lib/stats.mjs";

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const fmt = (n) => (n >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toFixed(1));
const sign = (n) => (n >= 0 ? "+" : "") + n.toFixed(1);

// All ops present in either side, in a stable order.
function opsFor(target, before, after) {
  const b = before.targets?.[target] ?? {};
  const a = after.targets?.[target] ?? {};
  return [...new Set([...Object.keys(b), ...Object.keys(a)])];
}

export function buildRows(target, before, after) {
  const b = before.targets?.[target] ?? {};
  const a = after.targets?.[target] ?? {};
  return opsFor(target, before, after).map((op) => {
    const bo = b[op]?.opsPerSec ?? 0;
    const ao = a[op]?.opsPerSec ?? 0;
    return {
      op,
      before: bo,
      after: ao,
      deltaPct: percentDelta(bo, ao),
      beforeMedianMs: b[op]?.medianMs ?? 0,
      afterMedianMs: a[op]?.medianMs ?? 0,
    };
  });
}

function svgChart(target, rows) {
  const W = 720,
    rowH = 46,
    padL = 120,
    padR = 80,
    padT = 30,
    barH = 14,
    gap = 6;
  const H = padT + rows.length * rowH + 20;
  const maxOps = Math.max(1, ...rows.flatMap((r) => [r.before, r.after]));
  const scale = (v) => (v / maxOps) * (W - padL - padR);
  const parts = [
    `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(target)} ops/sec">`,
  ];
  parts.push(
    `<text x="${padL}" y="18" font-size="13" font-weight="bold">${esc(target)} — ops/sec (higher is better)</text>`,
  );
  rows.forEach((r, i) => {
    const y = padT + i * rowH;
    parts.push(
      `<text x="${padL - 8}" y="${y + 14}" font-size="12" text-anchor="end">${esc(r.op)}</text>`,
    );
    // before bar (gray)
    parts.push(
      `<rect x="${padL}" y="${y}" width="${scale(r.before).toFixed(1)}" height="${barH}" fill="#9aa0a6"/>`,
    );
    parts.push(
      `<text x="${padL + scale(r.before) + 4}" y="${y + 12}" font-size="10" fill="#444">${esc(fmt(r.before))}</text>`,
    );
    // after bar (blue)
    const y2 = y + barH + gap;
    parts.push(
      `<rect x="${padL}" y="${y2}" width="${scale(r.after).toFixed(1)}" height="${barH}" fill="#1a73e8"/>`,
    );
    parts.push(
      `<text x="${padL + scale(r.after) + 4}" y="${y2 + 12}" font-size="10" fill="#1a73e8">${esc(fmt(r.after))} (${sign(r.deltaPct)}%)</text>`,
    );
  });
  parts.push(`</svg>`);
  return parts.join("\n");
}

function table(target, rows) {
  const head = `<tr><th>op</th><th>before ops/s</th><th>after ops/s</th><th>Δ%</th><th>before median ms</th><th>after median ms</th></tr>`;
  const body = rows
    .map(
      (r) =>
        `<tr><td>${esc(r.op)}</td><td>${esc(fmt(r.before))}</td><td>${esc(fmt(r.after))}</td>` +
        `<td class="${r.deltaPct >= 0 ? "up" : "down"}">${sign(r.deltaPct)}%</td>` +
        `<td>${r.beforeMedianMs.toFixed(4)}</td><td>${r.afterMedianMs.toFixed(4)}</td></tr>`,
    )
    .join("\n");
  return `<h2>${esc(target)}</h2><table>${head}${body}</table>`;
}

export function renderHtml(before, after) {
  const targets = [
    ...new Set([...Object.keys(before.targets ?? {}), ...Object.keys(after.targets ?? {})]),
  ];
  const sections = targets
    .map((t) => {
      const rows = buildRows(t, before, after);
      return `<section>${svgChart(t, rows)}${table(t, rows)}</section>`;
    })
    .join("\n");
  const meta = `before: ${esc(before.label)} @ ${esc(before.commit ?? "?")} · after: ${esc(after.label)} @ ${esc(after.commit ?? "?")}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ueberDB perf: before vs after</title>
<style>
body{font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif;margin:24px;color:#202124}
h1{font-size:20px} h2{font-size:15px;margin:18px 0 6px}
section{margin-bottom:28px;border-bottom:1px solid #eee;padding-bottom:12px}
table{border-collapse:collapse;font-size:12px} td,th{border:1px solid #ddd;padding:4px 8px;text-align:right}
th:first-child,td:first-child{text-align:left}
.up{color:#137333;font-weight:bold} .down{color:#c5221f;font-weight:bold}
.note{color:#5f6368;font-size:12px}
</style></head><body>
<h1>ueberDB performance — before vs after</h1>
<p class="note">${meta}</p>
<p class="note">Gray = before, blue = after. Δ% on ops/sec (positive = faster). Driver libs differ by their per-commit lockfile (e.g. mongodb minor version); see README.</p>
${sections}
</body></html>`;
}

// CLI: node benchmarks/render.mjs
function main() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(dir, "out");
  const before = JSON.parse(readFileSync(path.join(out, "before.json"), "utf8"));
  const after = JSON.parse(readFileSync(path.join(out, "after.json"), "utf8"));
  const html = renderHtml(before, after);
  writeFileSync(path.join(dir, "results.html"), html);
  writeFileSync(path.join(dir, "results.json"), JSON.stringify({ before, after }, null, 2));
  console.log("Wrote benchmarks/results.html and benchmarks/results.json");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test benchmarks/render.test.mjs`
Expected: PASS — both tests pass.

- [ ] **Step 5: Commit**

```bash
git add benchmarks/render.mjs benchmarks/render.test.mjs
git commit -m "feat(bench): self-contained inline-SVG HTML report renderer"
```

---

## Task 8: Per-side harness entry

**Files:**

- Create: `benchmarks/harness.mjs`

Runs one side. Reads env: `UEBERDB_ROOT` (tree root to import sources from),
`BENCH_LABEL` (`before`/`after`), `BENCH_TARGETS` (csv of `cache,pg,mongo`),
optional size overrides, and per-target connection env. Writes
`benchmarks/out/<label>.json`.

- [ ] **Step 1: Write the harness**

Create `benchmarks/harness.mjs`:

```js
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCacheBench } from "./cache-bench.mjs";
import { runPgBench } from "./pg-bench.mjs";
import { runMongoBench } from "./mongo-bench.mjs";

const env = process.env;
const root = env.UEBERDB_ROOT || process.cwd();
const label = env.BENCH_LABEL || "after";
const commit = env.BENCH_COMMIT || "";
const targets = (env.BENCH_TARGETS || "cache")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Size overrides (small values used for smoke runs).
const sizes = {
  iters: env.BENCH_ITERS ? Number(env.BENCH_ITERS) : undefined,
  warmup: env.BENCH_WARMUP ? Number(env.BENCH_WARMUP) : undefined,
  bulkRounds: env.BENCH_BULK_ROUNDS ? Number(env.BENCH_BULK_ROUNDS) : undefined,
  bulkBatch: env.BENCH_BULK_BATCH ? Number(env.BENCH_BULK_BATCH) : undefined,
};
const opts = Object.fromEntries(Object.entries(sizes).filter(([, v]) => v !== undefined));

async function main() {
  const out = { label, commit, node: process.version, targets: {} };

  if (targets.includes("cache")) {
    console.error(`[${label}] cache ...`);
    out.targets.cache = await runCacheBench(root, opts);
  }
  if (targets.includes("pg")) {
    console.error(`[${label}] postgres ...`);
    out.targets.postgres = await runPgBench(
      root,
      {
        host: env.PG_HOST,
        port: Number(env.PG_PORT),
        user: env.PG_USER,
        password: env.PG_PASSWORD,
        database: env.PG_DATABASE,
      },
      opts,
    );
  }
  if (targets.includes("mongo")) {
    console.error(`[${label}] mongo ...`);
    out.targets.mongodb = await runMongoBench(
      root,
      {
        url: env.MONGO_URL,
        database: env.MONGO_DATABASE,
      },
      opts,
    );
  }

  const dir = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.join(dir, "out");
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${label}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.error(`[${label}] wrote ${file}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

- [ ] **Step 2: Smoke-run the cache-only path against the current tree**

Run:

```bash
BENCH_LABEL=after BENCH_TARGETS=cache BENCH_ITERS=2000 BENCH_WARMUP=200 BENCH_BULK_ROUNDS=20 BENCH_BULK_BATCH=50 node benchmarks/harness.mjs
```

Expected: stderr shows `[after] cache ...` then `wrote .../out/after.json`;
`benchmarks/out/after.json` exists with `targets.cache` populated.

- [ ] **Step 3: Commit**

```bash
git add benchmarks/harness.mjs
git commit -m "feat(bench): per-side harness entry point"
```

---

## Task 9: Orchestrator — worktree, containers, run x2, render

**Files:**

- Create: `benchmarks/run.mjs`

- [ ] **Step 1: Write the orchestrator**

Create `benchmarks/run.mjs`:

```js
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GenericContainer, Wait } from "testcontainers";

const BEFORE_COMMIT = process.env.BEFORE_COMMIT || "809bcc2";
const AFTER_COMMIT = process.env.AFTER_COMMIT || "HEAD";
const TARGETS = process.env.BENCH_TARGETS || "cache,pg,mongo";

const benchDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(benchDir, "..");
const harness = path.join(benchDir, "harness.mjs");
const beforeRoot = path.resolve(repoRoot, "..", "ueberDB-bench-before");

const sh = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
const gitRev = (ref) =>
  execFileSync("git", ["rev-parse", "--short", ref], { cwd: repoRoot }).toString().trim();

function setupBeforeWorktree() {
  if (!existsSync(beforeRoot)) {
    console.error(`> git worktree add ${beforeRoot} ${BEFORE_COMMIT}`);
    sh("git", ["worktree", "add", "--detach", beforeRoot, BEFORE_COMMIT], repoRoot);
  } else {
    console.error(`> reusing existing worktree ${beforeRoot}`);
  }
  console.error(`> pnpm install (before) ...`);
  sh("pnpm", ["install", "--frozen-lockfile"], beforeRoot);
}

function runHarness(label, root, commit, extraEnv) {
  console.error(`\n=== harness: ${label} (${commit}) ===`);
  const res = spawnSync("node", [harness], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      UEBERDB_ROOT: root,
      BENCH_LABEL: label,
      BENCH_COMMIT: commit,
      BENCH_TARGETS: TARGETS,
      ...extraEnv,
    },
  });
  if (res.status !== 0) throw new Error(`harness ${label} failed with code ${res.status}`);
}

async function main() {
  const wantPg = TARGETS.includes("pg");
  const wantMongo = TARGETS.includes("mongo");
  let pg,
    mongo,
    connEnv = {};

  setupBeforeWorktree();

  if (wantPg) {
    console.error(`> starting postgres:14-alpine ...`);
    pg = await new GenericContainer("postgres:14-alpine")
      .withEnvironment({
        POSTGRES_USER: "ueberdb",
        POSTGRES_PASSWORD: "ueberdb",
        POSTGRES_DB: "ueberdb",
        POSTGRES_HOST_AUTH_METHOD: "trust",
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    connEnv = {
      ...connEnv,
      PG_HOST: pg.getHost(),
      PG_PORT: String(pg.getMappedPort(5432)),
      PG_USER: "ueberdb",
      PG_PASSWORD: "ueberdb",
      PG_DATABASE: "ueberdb",
    };
  }
  if (wantMongo) {
    console.error(`> starting mongo ...`);
    mongo = await new GenericContainer("mongo")
      .withExposedPorts(27017)
      .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
      .start();
    connEnv = {
      ...connEnv,
      MONGO_URL: `mongodb://${mongo.getHost()}:${mongo.getMappedPort(27017)}/?directConnection=true`,
      MONGO_DATABASE: "ueberdb_bench",
    };
  }

  try {
    // Run AFTER first against the live containers, then BEFORE against the same containers.
    runHarness("after", repoRoot, gitRev(AFTER_COMMIT), connEnv);
    runHarness("before", beforeRoot, gitRev(BEFORE_COMMIT), connEnv);
    console.error(`\n> rendering report ...`);
    sh("node", [path.join(benchDir, "render.mjs")], repoRoot);
    console.error(`\nDone. Open benchmarks/results.html`);
  } finally {
    if (pg) await pg.stop();
    if (mongo) await mongo.stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Syntax check**

Run: `node --check benchmarks/run.mjs && echo "syntax ok"`
Expected: prints `syntax ok`.

- [ ] **Step 3: Cache-only end-to-end (no docker) to validate orchestration + render**

Run:

```bash
BENCH_TARGETS=cache BENCH_ITERS=3000 BENCH_WARMUP=300 BENCH_BULK_ROUNDS=30 BENCH_BULK_BATCH=50 node benchmarks/run.mjs
```

Expected: creates the `before` worktree, runs `pnpm install` there, runs the
harness for both sides (cache only — no containers started), renders, and
prints `Open benchmarks/results.html`. Verify `benchmarks/results.html` exists
and opens in a browser showing a `cache` chart with before vs after bars.

- [ ] **Step 4: Commit**

```bash
git add benchmarks/run.mjs
git commit -m "feat(bench): orchestrator (worktree + testcontainers + render)"
```

---

## Task 10: Full run, README, and commit recorded results

**Files:**

- Create: `benchmarks/README.md`
- Commit: `benchmarks/results.html`, `benchmarks/results.json`

- [ ] **Step 1: Write the README**

Create `benchmarks/README.md`:

````markdown
# ueberDB perf benchmarks (before vs after)

Compares the library at a baseline commit (`809bcc2`, before the #993/#994/#997
perf commits) against `HEAD`, for three targets:

- **cache** — `CacheAndBufferLayer` hot paths, via an in-memory backend. No docker.
- **postgres** — driver called directly against `postgres:14-alpine` (docker).
- **mongodb** — driver called directly against `mongo` (docker).

The harness imports the library's `.ts` source directly (Node ≥24 strips types),
so there is **no build step**. The `before` side is a `git worktree` at the
baseline commit with its own `pnpm install`.

## Run

Everything (needs Docker running):

```bash
node benchmarks/run.mjs
```

Cache only (no Docker):

```bash
BENCH_TARGETS=cache node benchmarks/run.mjs
```

Output: `benchmarks/results.html` (self-contained chart) and
`benchmarks/results.json` (raw merged data).

## Knobs (env vars)

- `BENCH_TARGETS` — csv subset of `cache,pg,mongo` (default all).
- `BENCH_ITERS`, `BENCH_WARMUP`, `BENCH_BULK_ROUNDS`, `BENCH_BULK_BATCH` — workload sizes.
- `BEFORE_COMMIT` / `AFTER_COMMIT` — override the compared commits.

## Unit tests

```bash
node --test benchmarks/lib/*.test.mjs benchmarks/render.test.mjs
```

## Caveat

The `before` worktree installs the lockfile as it was at the baseline commit
(e.g. `mongodb@7.2.0`), while `after` uses the current lockfile (`mongodb@7.3.0`).
Reported deltas reflect ueberDB's own changes **and** any driver-library
minor-version differences. This is the honest "repo then vs now" comparison.
````

- [ ] **Step 2: Run the full unit-test suite**

Run: `node --test benchmarks/lib/stats.test.mjs benchmarks/lib/timing.test.mjs benchmarks/render.test.mjs`
Expected: all tests pass.

- [ ] **Step 3: Full benchmark run (Docker required)**

Run:

```bash
node benchmarks/run.mjs
```

Expected: starts Postgres + Mongo, runs both sides for all three targets,
renders. Verify `benchmarks/results.html` shows three charts (cache, postgres,
mongodb), each with before vs after bars and a delta table. Sanity-check the
direction of the deltas against the commit intentions (e.g. postgres `doBulk`
and mongodb `findKeys` should be faster on `after`).

If a result looks wrong (e.g. a regression that contradicts the commit), STOP
and investigate before recording — do not commit misleading numbers. Use
superpowers:systematic-debugging.

- [ ] **Step 4: Commit harness docs + recorded results**

The `.gitignore` ignores `results.html`/`results.json`; force-add the recorded
run so the comparison is reviewable:

```bash
git add benchmarks/README.md
git add -f benchmarks/results.html benchmarks/results.json
git commit -m "docs(bench): README + recorded before/after results"
```

- [ ] **Step 5: Clean up the worktree**

```bash
git worktree remove ../ueberDB-bench-before --force
```

---

## Self-Review

**Spec coverage:**

- Two baseline points (`809bcc2` vs `HEAD`) → Task 9 (`run.mjs`). ✓
- Isolation via worktree, no build, import `.ts` source → Tasks 4/5/6 (deep-import) + Task 9 (worktree + `pnpm install`, no build). ✓
- Cache via `CacheAndBufferLayer` + in-memory `doBulk` backend, `readsFromCache` assertion → Tasks 3 + 4. ✓
- Postgres driver direct (prepared get/set/remove, batched doBulk, findKeys) → Task 5. ✓
- Mongo driver direct (get/set/remove, unordered bulk, findKeys regex) → Task 6. ✓
- Measurement: warmup + N measured, mean/median/min/p95 + ops/sec → Tasks 1/2 (`summarize`, `timeLoop`). ✓
- Same container reused across before/after → Task 9 (containers started once; harness run twice). ✓
- Output: self-contained HTML with inline SVG + delta table, plus `results.json` → Task 7. ✓
- Driver-version caveat recorded → Task 10 README + render note. ✓
- Tests via `node:test` → Tasks 1/2/7. ✓
- Docker-unavailable degrades to cache-only → `BENCH_TARGETS=cache` path (Task 9 starts no container when pg/mongo not requested). ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; every run step has an exact command + expected output.

**Type/name consistency:** `summarize` shape (`opsPerSec`, `medianMs`, `p95Ms`, `minMs`, `meanMs`, `n`) is produced in Task 1 and consumed unchanged in `render.mjs` (Task 7) and the bench modules. `runCacheBench(root, opts)`, `runPgBench(root, conn, opts)`, `runMongoBench(root, conn, opts)` signatures match their callers in `harness.mjs` (Task 8). Harness writes `targets.cache` / `targets.postgres` / `targets.mongodb`; `render.mjs` iterates `targets` generically, so the names line up. `UEBERDB_ROOT`/`BENCH_*` env names match between `harness.mjs` and `run.mjs`.

**Known nuance to watch during execution:** if Node prints a `MODULE_TYPELESS_PACKAGE_JSON` warning when importing `.ts`, confirm the tree root has `"type": "module"` in its `package.json` (both the main tree and the worktree do, since they share the repo's `package.json`). The warning is harmless but indicates resolution context; it should not appear for in-repo imports.

---

## Post-implementation deltas (what changed during execution)

Three issues surfaced while running and were fixed in-flight; the committed code
reflects these, this section records them:

1. **Cache benchmark deadlock (Task 4).** A buffered `set()` only resolves once
   flushed, so awaiting each set under a long `writeInterval` hangs (and
   `remove()` is `set(key, null)`). Fixed: set/get/remove run unbuffered
   (`writeInterval: 0`); the flush benchmark fires sets without awaiting, lets
   them buffer, then times `flush()`. (Plan Task 4 already updated above.)

2. **Extensionless TS imports (Task 9/10).** Node strips types but does not
   resolve extensionless relative imports, so the driver sources
   (`../lib/AbstractDatabase`) failed to load. The cache target worked only
   because its single relative import is type-only. Fixed by adding
   `benchmarks/register-ts.mjs` (a `module.registerHooks` resolve hook that
   appends `.ts`) and loading it into the harness via `node --import`.

3. **Shared-container measurement bias + missing cache win (Task 10).** Both
   sides share one container with `after` running first, so `before` saw
   `after`'s leftover rows — inflating a spurious pg `findKeys` +118% and mongo
   `doBulk` −30%. Fixed by resetting the table/collection at the start of each DB
   side. Separately, the small `flush` case never exercised the dirty-key Set
   optimization, so a `flushBigCache` scenario (large mostly-clean cache, few
   dirty keys/flush) was added — it shows the real ~18× flush win.

**Recorded headline results (809bcc2 → HEAD):** postgres `doBulk` +248%,
postgres `get` +21%; cache `flushBigCache` +1759%. cache `getHit` −58% is the
deliberate read-path `structuredClone` safety tradeoff (the lock-free get win
needs concurrency, not captured by a sequential loop). Mongo deltas are within
±3% — its changes (anchored `findKeys` regex, dropped per-op ping) are
correctness/robustness wins that don't move local-container throughput.
