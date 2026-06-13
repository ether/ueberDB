# vitest-bench CI regression tracking

**Date:** 2026-06-13
**Status:** Design — approved, pending spec review

## Goal

Add a permanent CI job that runs the ueberDB performance workloads with
`vitest bench` and tracks the numbers over time, so a future change that **drops
performance** is surfaced automatically (chart history + PR/commit alert).

This complements — does not replace — the existing `benchmarks/` harness, which
does a one-off **before-vs-after** comparison across two git versions and renders
a static HTML chart. That harness answers "did this PR's perf work help?"; the
vitest-bench CI job answers "has performance regressed since last time?".

## Why vitest bench (vs the existing harness)

`vitest bench` measures the **current** code's throughput and is designed for
over-time tracking, which is exactly the regression-detection use case. It also
transpiles TypeScript itself, so the bench files import the library source
(`lib/CacheAndBufferLayer.ts`, `databases/postgres_db.ts`, etc.) **directly** —
no git worktree, no `register-ts.mjs` resolve hook, no manual type-stripping.
vitest 4.1.8 is already the project's test runner.

## Scope

All three targets are benched in CI (cache + Postgres + Mongo), per the approved
scope. Cache is pure-CPU and stable; the DB targets need containers and are
noisier (see Noise & alerting).

## Components

### Bench files — `benchmarks/*.bench.ts`

Picked up by `vitest bench` via a `benchmark.include` glob; excluded from the
normal `vitest run` test pass. Each file uses a `describe(<target>)` block so
bench names are stable and namespaced on the tracking chart
(e.g. `cache > getHit`).

- `benchmarks/cache.bench.ts`
  - Imports `Database` from `../lib/CacheAndBufferLayer`; wraps the existing
    `benchmarks/lib/memory-backend.mjs` (async Map backend with `doBulk`).
  - Benches: `set`, `getHit`, `getMiss`, `remove`, `flush`, `flushBigCache`.
  - As in the harness: set/get/remove use `writeInterval: 0` (a buffered `set`
    only settles on flush); `flush`/`flushBigCache` use a large `writeInterval`
    and dirty keys then flush. Prefill (e.g. the 20k clean entries for
    `flushBigCache`, and the `getHit` priming reads) happens in `beforeAll` /
    bench `setup` so it is not timed.
- `benchmarks/postgres.bench.ts`
  - `beforeAll`: start `postgres:14-alpine` via `testcontainers`
    (`GenericContainer`), construct the driver from `../databases/postgres_db`,
    `init()`. `afterAll`: stop the container.
  - Resets the `store` table before the measured work so accumulated rows don't
    skew `findKeys`/`doBulk`.
  - Benches: `set`, `get`, `findKeys`, `doBulk`, `remove` (driver called
    directly, promisified — same surface as the harness's `pg-bench.mjs`).
- `benchmarks/mongodb.bench.ts`
  - Same shape against a `mongo` container; collection `ueberdb_bench` cleared
    before measuring.

Containers use the Docker daemon preinstalled on GitHub-hosted runners, exactly
as the existing `postgres-resilience` / `rethink-resilience` jobs do.

Shared helpers (`payload`, the memory backend, the promisify-driver wrapper) are
reused from `benchmarks/lib/` to limit duplication with the harness.

### Output adapter — `benchmarks/ci/to-gab.mjs`

`vitest bench` writes a JSON results file. This adapter reads it and emits
`benchmarks/ci/output.json` in github-action-benchmark's **`customBiggerIsBetter`**
format:

```json
[{ "name": "cache > getHit", "unit": "ops/sec", "value": <hz> }, ...]
```

Using `hz` (ops/sec) with bigger-is-better means a **drop** in throughput is what
the action flags. The adapter is a pure transform (unit-testable with a fixture).

### CI job — `benchmark` in `.github/workflows/ci.yml`

Same pnpm/Node/cache/install boilerplate as the other jobs, then:

1. `pnpm bench:ci` — runs all bench files and writes `benchmarks/ci/output.json`.
2. `benchmark-action/github-action-benchmark@v1` with:
   - `tool: customBiggerIsBetter`
   - `output-file-path: benchmarks/ci/output.json`
   - `github-token: ${{ secrets.GITHUB_TOKEN }}`
   - `alert-threshold: '150%'` (flag when ≥1.5× slower than the baseline)
   - `comment-on-alert: true`
   - `fail-on-alert: false` (default — see Noise & alerting)
   - `auto-push: ${{ github.event_name == 'push' }}` (store history only on push
     to main; PRs compare + comment but do not push, avoiding fork-token write
     failures)
   - `gh-pages-branch: gh-pages`, `benchmark-data-dir-path: dev/bench`

Job-level `permissions: { contents: write, pull-requests: write }` (the workflow
default is `contents: read`).

Triggers: the existing `on: { push: [main, master], pull_request }` already
covers what we need; the job runs in both contexts with `auto-push` gated to
push events.

### Glue

- `package.json` scripts:
  - `"bench": "vitest bench --run"`
  - `"bench:ci": "vitest bench --run --outputJson=benchmarks/ci/results.json && node benchmarks/ci/to-gab.mjs"`
- `vitest.config.ts`: add a `benchmark` block with
  `include: ["benchmarks/**/*.bench.ts"]` so `*.bench.ts` are discovered and the
  normal test run ignores them. The existing `test` config is unchanged.

## Noise & alerting

The project already documents that DB-container tests are flaky on shared CI
runners; benchmark _throughput_ there fluctuates even more. Therefore:

- Default `fail-on-alert: false` — regressions are **commented/alerted**, not
  hard-failing red builds. This satisfies "check if it drops" without flaky
  failures. `alert-threshold: '150%'` is intentionally loose.
- Both the threshold and `fail-on-alert` are single-line knobs to tighten later
  (e.g. a stricter gate for the stable cache benches once a baseline of variance
  is observed).
- The cache benches are the reliable signal; PG/Mongo lines are informative but
  expected to be noisier.

## Testing

- Adapter (`to-gab.mjs`): a `node:test` unit test with a sample vitest JSON
  fixture asserting the converted `customBiggerIsBetter` shape and `hz`→`value`
  mapping.
- Bench files: validated by running `pnpm bench` locally (cache needs no Docker;
  PG/Mongo need Docker) and confirming each named bench produces an `hz`.
- A cache-only smoke (`vitest bench --run benchmarks/cache.bench.ts`) is the fast
  no-Docker check.

## Out of scope

- Hard-failing the build on regression (left as a future tightening once
  baseline variance is known).
- Benching other backends (mysql/redis/sqlite/etc.).
- Changing the existing harness or its recorded results.

## Caveats (to record in the bench README)

- github-action-benchmark creates and maintains a `gh-pages` branch and a
  published benchmark page on the repo.
- DB-throughput benches on shared runners are noisy; PG/Mongo alerts may
  occasionally be false positives — mitigated by the loose threshold and
  non-failing default.

## Decisions captured

- Scope: all three targets (cache + PG + Mongo).
- Regression mechanism: github-action-benchmark (history + alert/comment).
- Keep both the harness and the new vitest benches.
