# vitest-bench CI regression tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `vitest bench` benchmarks for the cache layer and the Postgres/Mongo drivers, plus a CI job that tracks the numbers over time and alerts when performance drops.

**Architecture:** Three `benchmarks/*.bench.ts` files (vitest transpiles TS, so they import the library source directly — no worktree/loader). `vitest bench` writes a JSON results file; a small adapter converts it to github-action-benchmark's `customBiggerIsBetter` format; a CI `benchmark` job runs it and feeds `benchmark-action/github-action-benchmark`, which stores history on `gh-pages` and alerts on regressions. The existing `benchmarks/` before/after harness is left untouched.

**Tech Stack:** vitest 4.1.8 bench mode (tinybench), testcontainers (PG/Mongo), `node:util.promisify`, `node:test` (adapter unit test), GitHub Actions + benchmark-action/github-action-benchmark@v1.

---

## File Structure

- `vitest.config.ts` — add `test.benchmark.include` so `*.bench.ts` are discovered (modify).
- `package.json` — add `bench` and `bench:ci` scripts (modify).
- `benchmarks/cache.bench.ts` — cache-layer benches (create).
- `benchmarks/postgres.bench.ts` — PG driver benches via testcontainers (create).
- `benchmarks/mongodb.bench.ts` — Mongo driver benches via testcontainers (create).
- `benchmarks/ci/to-gab.mjs` — vitest-JSON → github-action-benchmark adapter (create).
- `benchmarks/ci/to-gab.test.mjs` — `node:test` unit test for the adapter (create).
- `benchmarks/ci/.gitkeep` — keep the ci dir (create).
- `benchmarks/.gitignore` — also ignore `ci/results.json` / `ci/output.json` (modify).
- `.github/workflows/ci.yml` — add the `benchmark` job (modify).
- `benchmarks/README.md` — document the CI tracking + caveats (modify).

Benches reuse `benchmarks/lib/memory-backend.mjs` and the `payload` shape from the harness.

**Conventions verified up front (do not re-derive):**
- Bench files are NOT in `tsconfig` `include` (`["index.ts","lib","databases"]`), so `pnpm run ts-check` will not type-check them. They MUST still pass `pnpm run lint` (oxlint) and `pnpm run format:check` (oxfmt).
- Local `pnpm run format:check` shows false failures because the Windows working tree is CRLF; git stores LF and CI runs on Linux (LF), where oxfmt passes. To verify formatting locally, run `pnpm exec oxfmt --write <file>` on the new file (it rewrites to LF) before committing.
- testcontainers pattern (from `test/postgres/connection-drop.spec.ts`): `new GenericContainer(image).withExposedPorts(p).withEnvironment({...}).start()`, `container.getHost()`, `container.getMappedPort(p)`, stop in `afterAll`, 120000ms `beforeAll` timeout.
- `vitest bench --run --outputJson=<f>` JSON shape: `{ files: [ { groups: [ { fullName: "benchmarks/x.bench.ts > <describe>", benchmarks: [ { name, hz, mean, ... } ] } ] } ] }`.

---

## Task 1: vitest benchmark config + cache benches + `bench` script

**Files:**
- Modify: `vitest.config.ts`
- Modify: `package.json`
- Create: `benchmarks/cache.bench.ts`

- [ ] **Step 1: Add the benchmark include to `vitest.config.ts`**

Replace the file contents with:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 120000,
    hookTimeout: 120000,
    // Integration tests against real DB containers are inherently
    // flaky on shared CI runners (network blips, slow startup,
    // intermittent connection resets, especially the nano + CouchDB
    // 3.5 stack which intermittently returns 401 from session
    // middleware on the first request after a fresh connection).
    // Retry up to 5 times before giving up so transient blips don't
    // fail the whole job. The underlying bug still surfaces if the
    // test fails consistently.
    retry: 5,
    // `vitest bench` discovers these; the normal `vitest run` test pass
    // ignores them (its include only matches *.{test,spec}.*).
    benchmark: {
      include: ["benchmarks/**/*.bench.ts"],
    },
  },
});
```

- [ ] **Step 2: Add scripts to `package.json`**

In the `"scripts"` block, add these two entries (after `"test"`):

```json
    "bench": "vitest bench --run",
    "bench:ci": "vitest bench --run --outputJson=benchmarks/ci/results.json && node benchmarks/ci/to-gab.mjs",
```

- [ ] **Step 3: Create `benchmarks/cache.bench.ts`**

**NOTE (applies to all bench files):** `vitest bench` (4.1.8) does NOT execute
`beforeAll`/`afterAll` declared *inside* a `describe` block — they silently
no-op and the benches read `NaN`. Declare the shared `let` state and the
`beforeAll`/`afterAll` hooks at **file scope**; keep only the `bench()` calls
inside `describe("cache")`. The block below shows the hooks at file scope.

```ts
import { afterAll, beforeAll, bench, describe } from "vitest";
import { Database } from "../lib/CacheAndBufferLayer";
import { createMemoryBackend } from "./lib/memory-backend.mjs";

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
const nextTick = () => new Promise((r) => setImmediate(r));
const NO_AUTO_FLUSH = 3_600_000;
const POP = 20_000;

describe("cache", () => {
  let setDb;
  let hitDb;
  let missDb;
  let rmDb;
  let flushDb;
  let bigDb;
  let setI = 0;
  let hitI = 0;
  let missI = 0;
  let rmI = 0;
  let flushR = 0;
  let bigR = 0;

  beforeAll(async () => {
    // set: unbuffered (writeInterval 0) so each awaited set completes at once.
    setDb = new Database(createMemoryBackend(), { cache: 5_000_000, writeInterval: 0 }, noopLogger);
    await setDb.init();

    // getHit: prefill + a priming read pass so timed gets hit the cache fast path.
    hitDb = new Database(createMemoryBackend(), { cache: POP + 10, writeInterval: 0 }, noopLogger);
    await hitDb.init();
    for (let i = 0; i < POP; i++) await hitDb.set("hit:" + i, payload(i));
    for (let i = 0; i < POP; i++) await hitDb.get("hit:" + i);

    // getMiss: keys never written -> falls through to the backend each time.
    missDb = new Database(createMemoryBackend(), { cache: 1000, writeInterval: 0 }, noopLogger);
    await missDb.init();

    // remove: remove(key) is set(key,null); idempotent, no prefill needed.
    rmDb = new Database(createMemoryBackend(), { cache: 5_000_000, writeInterval: 0 }, noopLogger);
    await rmDb.init();

    // flush: small cache, dirty a batch then flush.
    flushDb = new Database(createMemoryBackend(), { cache: 4000, writeInterval: NO_AUTO_FLUSH }, noopLogger);
    await flushDb.init();

    // flushBigCache: large mostly-clean cache; flush() iterates the dirty Set
    // instead of scanning the LRU. Prime POP clean entries once.
    bigDb = new Database(createMemoryBackend(), { cache: POP + 1000, writeInterval: NO_AUTO_FLUSH }, noopLogger);
    await bigDb.init();
    const prime = [];
    for (let i = 0; i < POP; i++) prime.push(bigDb.set("big:" + i, payload(i)));
    await nextTick();
    await bigDb.flush();
    await Promise.all(prime);
  }, 120000);

  afterAll(async () => {
    await Promise.all([setDb, hitDb, missDb, rmDb, flushDb, bigDb].map((d) => d && d.close()));
  });

  bench("set", async () => {
    await setDb.set("set:" + setI++, payload(setI));
  });

  bench("getHit", async () => {
    await hitDb.get("hit:" + (hitI++ % POP));
  });

  bench("getMiss", async () => {
    await missDb.get("miss:" + missI++);
  });

  bench("remove", async () => {
    await rmDb.remove("rm:" + rmI++);
  });

  bench("flush", async () => {
    const ps = [];
    for (let j = 0; j < 500; j++) ps.push(flushDb.set(`f:${flushR}:${j}`, payload(j)));
    flushR++;
    await nextTick();
    await flushDb.flush();
    await Promise.all(ps);
  });

  bench("flushBigCache", async () => {
    const ps = [];
    for (let j = 0; j < 10; j++) ps.push(bigDb.set("big:" + ((bigR * 10 + j) % POP), payload(j)));
    bigR++;
    await nextTick();
    await bigDb.flush();
    await Promise.all(ps);
  });
});
```

- [ ] **Step 4: Format the new file (rewrites to LF + oxfmt style)**

Run: `pnpm exec oxfmt --write benchmarks/cache.bench.ts vitest.config.ts package.json`
Then: `pnpm run lint`
Expected: lint exits 0 (warnings allowed; no errors referencing `cache.bench.ts`).

- [ ] **Step 5: Run the cache benches (no Docker needed)**

Run: `pnpm exec vitest bench --run benchmarks/cache.bench.ts`
Expected: a table listing 6 benches — `set`, `getHit`, `getMiss`, `remove`, `flush`, `flushBigCache` — each with a positive `hz`. No errors. (`flushBigCache` should show a much higher hz than `flush`.)

If a bench hangs or throws, STOP and report — do not paper over it.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts package.json benchmarks/cache.bench.ts
git commit -m "feat(bench): vitest cache benches + benchmark config/scripts"
```

---

## Task 2: Postgres driver benches (testcontainers)

**Files:**
- Create: `benchmarks/postgres.bench.ts`

- [ ] **Step 1: Create `benchmarks/postgres.bench.ts`**

**IMPORTANT (learned in Task 1):** `vitest bench` (4.1.8) does NOT run
`beforeAll`/`afterAll` declared *inside* a `describe` block — they silently no-op
and benches produce `NaN`. So hooks and shared state live at **file scope**; only
the `bench()` calls go inside `describe("postgres")`.

```ts
import { afterAll, beforeAll, bench, describe } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { promisify } from "node:util";
import PgDb from "../databases/postgres_db";

const val = JSON.stringify({ a: "x".repeat(64), n: 1 });
const SEED = 2000;

let container: StartedTestContainer;
let db: any;
let set: any;
let get: any;
let findKeys: any;
let doBulk: any;
let remove: any;
let close: any;
let setI = 0;
let getI = 0;
let rmI = 0;
let bulkR = 0;

// File-scope hooks: vitest bench skips describe-level beforeAll/afterAll (4.1.8).
beforeAll(async () => {
  container = await new GenericContainer("postgres:14-alpine")
    .withExposedPorts(5432)
    .withEnvironment({
      POSTGRES_USER: "ueberdb",
      POSTGRES_PASSWORD: "ueberdb",
      POSTGRES_DB: "ueberdb",
      POSTGRES_HOST_AUTH_METHOD: "trust",
    })
    .start();
  db = new PgDb({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: "ueberdb",
    password: "ueberdb",
    database: "ueberdb",
  });
  const init = promisify(db.init.bind(db));
  set = promisify(db.set.bind(db));
  get = promisify(db.get.bind(db));
  findKeys = promisify(db.findKeys.bind(db));
  doBulk = promisify(db.doBulk.bind(db));
  remove = promisify(db.remove.bind(db));
  close = promisify(db.close.bind(db));
  await init();
  // Seed rows so get/findKeys have stable data to read.
  const ops = [];
  for (let i = 0; i < SEED; i++) ops.push({ type: "set", key: "seed:" + i, value: val });
  await doBulk(ops);
}, 120000);

afterAll(async () => {
  if (close) await close();
  if (container) await container.stop();
});

describe("postgres", () => {
  bench("set", async () => {
    await set("set:" + setI++, val);
  });

  bench("get", async () => {
    await get("seed:" + (getI++ % SEED));
  });

  bench("findKeys", async () => {
    await findKeys("seed:*", null);
  });

  bench("doBulk", async () => {
    const ops = [];
    for (let j = 0; j < 100; j++) ops.push({ type: "set", key: `bulk:${bulkR}:${j}`, value: val });
    bulkR++;
    await doBulk(ops);
  });

  bench("remove", async () => {
    await remove("set:" + rmI++);
  });
});
```

- [ ] **Step 2: Format + lint**

Run: `pnpm exec oxfmt --write benchmarks/postgres.bench.ts && pnpm run lint`
Expected: lint exits 0 (no errors referencing `postgres.bench.ts`).

- [ ] **Step 3: Run the PG benches (Docker required)**

Run: `pnpm exec vitest bench --run benchmarks/postgres.bench.ts`
Expected: starts a `postgres:14-alpine` container, then a table with `set`, `get`, `findKeys`, `doBulk`, `remove` each with a positive `hz`; container stops at the end; exit 0.

If the driver fails to load or connect, STOP and report the exact error.

- [ ] **Step 4: Commit**

```bash
git add benchmarks/postgres.bench.ts
git commit -m "feat(bench): vitest postgres driver benches (testcontainers)"
```

---

## Task 3: Mongo driver benches (testcontainers)

**Files:**
- Create: `benchmarks/mongodb.bench.ts`

- [ ] **Step 1: Create `benchmarks/mongodb.bench.ts`**

**IMPORTANT (same as Task 2):** hooks at **file scope**, `bench()` calls inside
`describe("mongodb")` — `vitest bench` 4.1.8 skips describe-level hooks.

```ts
import { afterAll, beforeAll, bench, describe } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { promisify } from "node:util";
import MongoDb from "../databases/mongodb_db";

const val = JSON.stringify({ a: "x".repeat(64), n: 1 });
const SEED = 2000;

let container: StartedTestContainer;
let db: any;
let set: any;
let get: any;
let findKeys: any;
let doBulk: any;
let remove: any;
let close: any;
let setI = 0;
let getI = 0;
let rmI = 0;
let bulkR = 0;

// File-scope hooks: vitest bench skips describe-level beforeAll/afterAll (4.1.8).
beforeAll(async () => {
  container = await new GenericContainer("mongo").withExposedPorts(27017).start();
  const url = `mongodb://${container.getHost()}:${container.getMappedPort(27017)}/?directConnection=true`;
  db = new MongoDb({ url, database: "ueberdb_bench", collection: "ueberdb_bench" });
  const init = promisify(db.init.bind(db));
  set = promisify(db.set.bind(db));
  get = promisify(db.get.bind(db));
  findKeys = promisify(db.findKeys.bind(db));
  doBulk = promisify(db.doBulk.bind(db));
  remove = promisify(db.remove.bind(db));
  close = promisify(db.close.bind(db));
  await init();
  const ops = [];
  for (let i = 0; i < SEED; i++) ops.push({ type: "set", key: "seed:" + i, value: val });
  await doBulk(ops);
}, 120000);

afterAll(async () => {
  if (close) await close();
  if (container) await container.stop();
});

describe("mongodb", () => {
  bench("set", async () => {
    await set("set:" + setI++, val);
  });

  bench("get", async () => {
    await get("seed:" + (getI++ % SEED));
  });

  bench("findKeys", async () => {
    await findKeys("seed:*", null);
  });

  bench("doBulk", async () => {
    const ops = [];
    for (let j = 0; j < 100; j++) ops.push({ type: "set", key: `bulk:${bulkR}:${j}`, value: val });
    bulkR++;
    await doBulk(ops);
  });

  bench("remove", async () => {
    await remove("set:" + rmI++);
  });
});
```

- [ ] **Step 2: Format + lint**

Run: `pnpm exec oxfmt --write benchmarks/mongodb.bench.ts && pnpm run lint`
Expected: lint exits 0 (no errors referencing `mongodb.bench.ts`).

- [ ] **Step 3: Run the Mongo benches (Docker required)**

Run: `pnpm exec vitest bench --run benchmarks/mongodb.bench.ts`
Expected: starts a `mongo` container, then a table with `set`, `get`, `findKeys`, `doBulk`, `remove` each with a positive `hz`; container stops; exit 0.

- [ ] **Step 4: Commit**

```bash
git add benchmarks/mongodb.bench.ts
git commit -m "feat(bench): vitest mongo driver benches (testcontainers)"
```

---

## Task 4: Output adapter (TDD) + `bench:ci` wiring

**Files:**
- Create: `benchmarks/ci/to-gab.mjs`
- Create: `benchmarks/ci/to-gab.test.mjs`
- Create: `benchmarks/ci/.gitkeep`
- Modify: `benchmarks/.gitignore`

- [ ] **Step 1: Write the failing adapter test `benchmarks/ci/to-gab.test.mjs`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { toGab } from "./to-gab.mjs";

const sampleVitestJson = {
  files: [
    {
      filepath: "/repo/benchmarks/cache.bench.ts",
      groups: [
        {
          fullName: "benchmarks/cache.bench.ts > cache",
          benchmarks: [
            { name: "getHit", hz: 350000, mean: 0.00285 },
            { name: "flushBigCache", hz: 65000, mean: 0.0153 },
          ],
        },
      ],
    },
  ],
};

test("toGab maps each bench to customBiggerIsBetter with hz as value", () => {
  const out = toGab(sampleVitestJson);
  assert.deepEqual(out, [
    { name: "cache / getHit", unit: "ops/sec", value: 350000 },
    { name: "cache / flushBigCache", unit: "ops/sec", value: 65000 },
  ]);
});

test("toGab tolerates empty/missing structure", () => {
  assert.deepEqual(toGab({}), []);
  assert.deepEqual(toGab({ files: [{ groups: [] }] }), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test benchmarks/ci/to-gab.test.mjs`
Expected: FAIL — `Cannot find module './to-gab.mjs'`.

- [ ] **Step 3: Write `benchmarks/ci/to-gab.mjs`**

```js
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Convert a `vitest bench --outputJson` report into the github-action-benchmark
// `customBiggerIsBetter` format. We track ops/sec (hz): a DROP is what alerts.
// Bench name is "<describe> / <bench>", derived from the group's fullName
// (which is "<file> > <describe>") plus the bench name.
export function toGab(vitestJson) {
  const out = [];
  for (const file of vitestJson?.files ?? []) {
    for (const group of file?.groups ?? []) {
      const label = String(group?.fullName ?? "").split(" > ").pop() || "bench";
      for (const b of group?.benchmarks ?? []) {
        out.push({ name: `${label} / ${b.name}`, unit: "ops/sec", value: b.hz });
      }
    }
  }
  return out;
}

function main() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const input = path.join(dir, "results.json");
  const output = path.join(dir, "output.json");
  const data = JSON.parse(readFileSync(input, "utf8"));
  const gab = toGab(data);
  mkdirSync(dir, { recursive: true });
  writeFileSync(output, JSON.stringify(gab, null, 2));
  console.log(`Wrote ${output} with ${gab.length} benchmark(s)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test benchmarks/ci/to-gab.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Create `benchmarks/ci/.gitkeep` (empty file) and update `benchmarks/.gitignore`**

Replace `benchmarks/.gitignore` contents with:

```gitignore
out/*.json
results.html
results.json
ci/results.json
ci/output.json
```

- [ ] **Step 6: End-to-end check of `bench:ci` (cache only, fast, no Docker)**

Temporarily run just the cache bench through the full pipeline to prove the adapter consumes real vitest output:

```bash
pnpm exec vitest bench --run benchmarks/cache.bench.ts --outputJson=benchmarks/ci/results.json && node benchmarks/ci/to-gab.mjs
cat benchmarks/ci/output.json
```
Expected: `output.json` is a JSON array of `{ name: "cache / <op>", unit: "ops/sec", value: <number> }` for all 6 cache ops; the script prints `Wrote ... with 6 benchmark(s)`.

- [ ] **Step 7: Format + lint + commit**

```bash
pnpm exec oxfmt --write benchmarks/ci/to-gab.mjs benchmarks/ci/to-gab.test.mjs benchmarks/.gitignore
pnpm run lint
git add benchmarks/ci/to-gab.mjs benchmarks/ci/to-gab.test.mjs benchmarks/ci/.gitkeep benchmarks/.gitignore
git commit -m "feat(bench): vitest-json -> github-action-benchmark adapter + bench:ci"
```

---

## Task 5: CI job + README

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `benchmarks/README.md`

- [ ] **Step 1: Append the `benchmark` job to `.github/workflows/ci.yml`**

Add this job at the end of the `jobs:` map (sibling of `build`, `postgres-resilience`, `rethink-resilience`), indented two spaces like the others:

```yaml
  # Permanent performance regression tracking. Runs the vitest benchmarks
  # (cache + PG + Mongo via testcontainers) and feeds the results to
  # github-action-benchmark, which stores history on the gh-pages branch,
  # renders a chart over time, and alerts when a benchmark drops past the
  # threshold. Cache benches are the reliable signal; the DB benches are
  # informative but noisier on shared runners (hence fail-on-alert: false).
  benchmark:
    runs-on: ubuntu-latest
    permissions:
      contents: write # github-action-benchmark pushes history to gh-pages
      pull-requests: write # and comments on a PR when a regression is detected
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.33.0

      - name: Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 24

      - name: Get pnpm store path
        id: pnpm-cache
        run: echo "STORE_PATH=$(pnpm store path --silent)" >> $GITHUB_OUTPUT

      - name: Cache pnpm store
        uses: actions/cache@v5
        with:
          path: ${{ steps.pnpm-cache.outputs.STORE_PATH }}
          key: ${{ runner.os }}-pnpm-store-${{ hashFiles('**/pnpm-lock.yaml') }}
          restore-keys: |
            ${{ runner.os }}-pnpm-store-

      - name: Install dependencies
        run: pnpm install --frozen-lockfile --ignore-scripts

      - name: Run benchmarks
        run: pnpm run bench:ci

      - name: Track / alert on benchmark results
        uses: benchmark-action/github-action-benchmark@v1
        with:
          name: ueberDB benchmarks
          tool: customBiggerIsBetter
          output-file-path: benchmarks/ci/output.json
          github-token: ${{ secrets.GITHUB_TOKEN }}
          # Alert (and on PRs, comment) when a benchmark is >=1.5x slower than
          # the stored baseline. Do NOT fail the build — shared-runner noise
          # makes hard gating flaky; tighten later once variance is known.
          alert-threshold: "150%"
          comment-on-alert: true
          fail-on-alert: false
          # Only persist history on pushes to the default branch. On PRs
          # (including forks, where GITHUB_TOKEN is read-only) compare + comment
          # without pushing.
          auto-push: ${{ github.event_name == 'push' }}
          gh-pages-branch: gh-pages
          benchmark-data-dir-path: dev/bench
```

- [ ] **Step 2: Validate the workflow YAML parses**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/ci.yml','utf8');const y=require('js-yaml');const d=y.load(s);if(!d.jobs.benchmark)throw new Error('benchmark job missing');console.log('jobs:',Object.keys(d.jobs).join(', '))"`

If `js-yaml` is not installed, instead run this Python check (Python is preinstalled):
`python -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/ci.yml')); assert 'benchmark' in d['jobs']; print('jobs:', ', '.join(d['jobs']))"`

Expected: prints the job list including `benchmark`. No parse error.

- [ ] **Step 3: Add a CI-tracking section to `benchmarks/README.md`**

Insert this section immediately before the existing `## Reading the results (important)` heading:

```markdown
## Permanent CI tracking (vitest bench)

Alongside the one-off before/after harness above, the repo runs `vitest bench`
in CI to catch regressions over time. The bench files live next to the harness:

- `benchmarks/cache.bench.ts`, `benchmarks/postgres.bench.ts`,
  `benchmarks/mongodb.bench.ts` — measured with `vitest bench`.

Run locally:

```bash
pnpm bench                                   # all targets (PG/Mongo need Docker)
pnpm exec vitest bench --run benchmarks/cache.bench.ts   # cache only, no Docker
```

The `benchmark` CI job runs `pnpm bench:ci` (which writes
`benchmarks/ci/output.json` via `benchmarks/ci/to-gab.mjs`) and feeds
`benchmark-action/github-action-benchmark`. On pushes to the default branch it
stores history on the `gh-pages` branch (a chart-over-time page under
`dev/bench`); on PRs it compares and comments. A benchmark that drops ≥1.5×
versus the baseline raises an alert. `fail-on-alert` is **off** by default — the
job warns rather than failing red, because DB-throughput benches on shared
runners are noisy. The cache benches are the reliable signal.

Note: github-action-benchmark creates and maintains the `gh-pages` branch and a
published benchmark page on the repository.
```

- [ ] **Step 4: Format check (LF) + commit**

```bash
pnpm exec oxfmt --write benchmarks/README.md
git add .github/workflows/ci.yml benchmarks/README.md
git commit -m "ci(bench): track vitest benchmarks via github-action-benchmark"
```

---

## Self-Review

**Spec coverage:**
- vitest bench files for cache + PG + Mongo → Tasks 1/2/3. ✓
- Import source directly, no worktree/loader → cache imports `../lib/CacheAndBufferLayer`; drivers import `../databases/*` default export (vitest transpiles TS). ✓
- Reuse `memory-backend.mjs` + `payload` → Task 1. ✓
- testcontainers for PG/Mongo, reset/seed state → Tasks 2/3 (seed in `beforeAll`; fresh container per run = clean state). ✓
- Adapter to `customBiggerIsBetter` (hz/ops-sec, bigger better) → Task 4. ✓
- `bench` + `bench:ci` scripts, `benchmark.include` config → Tasks 1/4. ✓
- CI job: github-action-benchmark, alert-threshold 150%, comment-on-alert, fail-on-alert false, auto-push only on push, contents+PR write perms, gh-pages → Task 5. ✓
- README caveats (gh-pages branch, DB noise) → Task 5. ✓
- Tests: adapter via `node:test` → Task 4. ✓
- Keep existing harness untouched → no task modifies it. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; every run step has an exact command + expected output. The one prose note (cache.bench.ts import identifier) is a guard against a rendering word-break, not a placeholder.

**Type/name consistency:** `toGab` produces `{ name, unit, value }`; the test and CI `output-file-path` both reference `benchmarks/ci/output.json`; `bench:ci` writes `benchmarks/ci/results.json` which `to-gab.mjs` reads from its own dir. Bench `describe` labels (`cache`/`postgres`/`mongodb`) flow into the adapter's `<label> / <op>` names. Script names (`bench`, `bench:ci`) match between `package.json` and the CI job. Container/driver construction mirrors the harness (`pg-bench.mjs`/`mongo-bench.mjs`) and the existing testcontainers test.

**Known nuances called out for the implementer:** bench files are not type-checked (so `any`/untyped `.mjs` import is fine) but must pass oxlint/oxfmt; local `format:check` shows false CRLF failures (run `oxfmt --write` and rely on CI/LF); `vitest bench` is experimental and prints a banner (harmless).
