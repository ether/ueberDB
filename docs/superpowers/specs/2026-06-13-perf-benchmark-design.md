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

### Drive through the public ueberDB API

All measurements go through the stable public surface
(`init / get / set / remove / findKeys / doBulk`), which is identical in both
versions. Each backend naturally exercises the changed code:

| Backend            | Exercises                                              | Infra            |
|--------------------|-------------------------------------------------------|------------------|
| `memory`           | `CacheAndBufferLayer` hot paths (no real I/O)         | none             |
| `postgres`         | batched `doBulk` upsert + prepared `get/set/remove`   | docker `postgres:14-alpine` |
| `mongodb`          | no per-op ping, unordered bulk, `findKeys` regex      | docker `mongo`   |

Using the `memory` backend for the cache means timing reflects the cache/buffer
layer changes rather than driver or network cost.

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

`benchmarks/results.html` — a self-contained file:

- One grouped bar chart per backend (before vs after, x-axis = operation,
  y-axis = ops/sec or median latency). Chart.js inlined (no network at view
  time).
- A markdown/HTML summary table with before, after, and **% delta** per op.

Raw measurements also written to `benchmarks/results.json` for reproducibility.

## Components

- `benchmarks/harness.ts` — workload definitions + timing loop; reads
  `UEBERDB_DIST` to import the build under test; writes one JSON result set.
- `benchmarks/run.ts` (or a small script) — orchestrates: start containers,
  build both worktrees, run harness twice, merge JSON, render HTML, tear down.
- `benchmarks/render.ts` — turns merged JSON into `results.html`.
- `benchmarks/README.md` — how to run it.

The harness and renderer are committed under `benchmarks/`. Generated
`results.html` / `results.json` are committed as the recorded result of this
comparison (or gitignored if we prefer to regenerate — decide at implementation
time; default: commit the harness, commit a sample result).

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
