# Perf Benchmark: before vs after (cache + Postgres + Mongo)

**Date:** 2026-06-13
**Status:** Design — approved scope, pending spec review

## Goal

Measure the impact of the three performance commits landed on `main` by
benchmarking the library's public API against a clean pre-perf baseline, and
render the comparison as a self-contained HTML chart.

The three commits under test (all after `809bcc2`):

- `acd8cd9` — `perf(cache)`: hot-path wins in `CacheAndBufferLayer`
  (structuredClone read path, dirty-key `Set`, lazy flush, lock-free `get`).
- `73fdb5f` — `perf(mongodb)`: drop per-op ping, fix `findKeys` regex,
  unordered bulk.
- `70e76da` — `perf(postgres)`: batched multi-row `doBulk` upsert + named
  prepared statements.

## Baseline points

- **Before** = `809bcc2` (semver dev-dep bump; the commit immediately before
  the first perf commit `70e76da`). Clean pre-perf state.
- **After** = `HEAD` (`0f21e7a`, 6.1.10).

## Approach

### Isolation via two git worktrees

Create two worktrees and build each:

- `before/` checked out at `809bcc2`
- `after/`  checked out at `HEAD`

Each gets `pnpm install --frozen-lockfile` + `pnpm run build`. The benchmark
harness lives in the **main** working tree (`benchmarks/`), outside both
worktrees, and is run twice — once pointed at `before/dist`, once at
`after/dist` — via an env var (`UEBERDB_DIST`). Same harness, same machine,
same docker containers → only library code differs between runs.

Worktrees are created via the `using-git-worktrees` skill (native tool or
`git worktree` fallback). They are temporary build scratch space, not
committed.

### Measure each commit at the layer it changed (refined during planning)

The three commits changed two different layers, so a single uniform entry point
does not faithfully exercise all of them. Concretely: the `CacheAndBufferLayer`
flushes writes through the driver's `doBulk`, so the Postgres single-row
prepared `set`/`remove` statements and the Mongo/PG `findKeys` paths are
*bypassed* when driving purely through the public API. We therefore measure
each commit at its own layer:

| Target            | Entry point                          | Exercises                                              | Infra            |
|-------------------|--------------------------------------|--------------------------------------------------------|------------------|
| cache (`acd8cd9`) | **`CacheAndBufferLayer` `Database` class, deep-imported** from `dist/lib/CacheAndBufferLayer.js`, wrapping a harness-local in-memory async backend that implements `doBulk` | `CacheAndBufferLayer` hot paths (structuredClone read, dirty-key Set, lock-free get, lazy flush) | none |
| postgres (`70e76da`) | **driver class directly** (`dist/databases/postgres_db.js`) | prepared `get`/`set`/`remove`, batched multi-row `doBulk` upsert, `findKeys` | docker `postgres:14-alpine` |
| mongodb (`73fdb5f`) | **driver class directly** (`dist/databases/mongodb_db.js`) | `get`/`set`/`remove`, unordered bulk `doBulk`, fixed `findKeys` regex | docker `mongo` |

For the cache target we do not use the public `Database`/`memory` backend: the
`memory` backend forces `cache=0` and does not implement `doBulk`, so enabling
caching on it would throw on flush. Instead the harness constructs the
`CacheAndBufferLayer` `Database` directly (`new Database(backend, { cache:
100000, writeInterval: 100 }, noopLogger)`) around a harness-local async
backend backed by a `Map` that implements `init/close/get/set/remove/findKeys/
doBulk` and reports `isAsync === true`. Underlying I/O is then a fast in-memory
Map, so timing reflects the cache layer, not storage. The harness asserts
`metrics.readsFromCache` advances to confirm the cache-hit path is actually
measured.

Both driver classes are callback-style (`isAsync` is false / unset); the
harness wraps their methods with `util.promisify` to drive them.

**Caveat to record in the report:** the `before` worktree installs the
lockfile as it was at `809bcc2` (e.g. `mongodb@7.2.0`), while `after` uses the
current lockfile (`mongodb@7.3.0`). The measured deltas reflect our code
changes *and* any driver-library minor-version differences. This is the honest
"state of the repo then vs now"; the report notes it explicitly.

### Measurement methodology

For each `(backend × operation)`:

1. **Warmup** iterations (discarded) to settle JIT / connection pools / prepared
   statement caches.
2. **N measured** iterations timed with `performance.now()`.
3. Report **mean / median / min / p95** latency and **ops/sec**.

Operations measured per backend:

- `set` (single-row write)
- `get` cache-hit
- `get` cache-miss (forces underlying read)
- `findKeys` (wildcard query)
- `remove`
- `doBulk` (batch write)

The **same** docker container instance is reused across the before and after
runs for a given backend, so container provisioning variance does not pollute
the comparison. Containers are started once, both library versions run against
them sequentially, then containers are torn down.

### Default workload parameters (adjustable)

- Cache (`memory`): 100k iterations per op, 10k warmup.
- DB backends: 2,000–5,000 ops per single-row op, 500 warmup.
- `doBulk`: batches of 100 keys.
- Value payload: a small JSON object (a few string/number fields), the same in
  both runs.

### Output

`benchmarks/results.html` — a self-contained file with **no external
resources** (no CDN, no JS library):

- One grouped bar chart per target, drawn as inline `<svg>` `<rect>` bars
  (before vs after per operation, y-axis = ops/sec). Hand-rolled so the file
  renders offline with zero dependencies.
- An HTML summary table with before, after, and **% delta** per op.

Raw measurements also written to `benchmarks/results.json` for reproducibility.

## Components

Plain ESM JavaScript (`.mjs`), run directly on Node ≥24 (no build step for the
harness itself; it imports the already-built library `dist`):

- `benchmarks/lib/stats.mjs` — pure stats: mean/median/min/p95/opsPerSec/percentDelta.
- `benchmarks/lib/timing.mjs` — `timeLoop({ warmup, iters, fn })` → per-iteration
  samples + stats.
- `benchmarks/lib/memory-backend.mjs` — harness-local async `Map` backend
  (implements `doBulk`) for the cache target.
- `benchmarks/cache-bench.mjs` — cache workload via deep-imported
  `CacheAndBufferLayer`.
- `benchmarks/pg-bench.mjs` — Postgres driver-direct workload.
- `benchmarks/mongo-bench.mjs` — Mongo driver-direct workload.
- `benchmarks/harness.mjs` — entry: reads `UEBERDB_DIST` + container conn env,
  runs the requested targets, writes `<label>.json`.
- `benchmarks/render.mjs` — merges `before.json` + `after.json` → self-contained
  `results.html` (inline SVG) + `results.json`.
- `benchmarks/run.mjs` — orchestrator: build `after`, add+build a `before`
  worktree at `809bcc2`, start PG/Mongo via testcontainers, run harness twice,
  render, tear down.
- `benchmarks/README.md` — how to run it.

Unit tests for the pure pieces (`stats`, `render`) use Node's built-in
`node:test` runner (`node --test`) to keep the harness self-contained and avoid
touching the repo's vitest config. The harness and renderer are committed under
`benchmarks/`; a generated `results.html` / `results.json` from one run is
committed as the recorded result.

## Error handling

- If docker is unavailable, the DB backends are skipped with a clear message
  and the cache benchmark still runs.
- Harness fails loudly if `UEBERDB_DIST` build is missing/stale.
- Each backend run is independent; a failure in one backend does not abort the
  others.

## Out of scope

- Other backends (mysql, redis, sqlite, etc.) — only the three with perf
  changes.
- hyperfine / process-level benchmarking — explicitly dropped in favor of
  in-process per-op precision.
- CI integration / regression gating — this is a one-off comparison harness,
  though committing it leaves the door open.

## Decisions captured

- Scope: all three areas (cache + Postgres + Mongo).
- Output: self-contained HTML chart.
- Tooling: in-process only (no hyperfine).
- Harness: committed to `benchmarks/`.
