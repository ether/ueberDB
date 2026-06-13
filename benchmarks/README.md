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
node --test benchmarks/lib/stats.test.mjs benchmarks/lib/timing.test.mjs benchmarks/render.test.mjs
```

## How each target is measured

- **cache** ops (`set`, `getHit`, `getMiss`, `remove`) run with caching enabled
  but `writeInterval: 0` (unbuffered), so each awaited op completes immediately
  against a trivial in-memory `Map` backend — isolating the cache-layer CPU work
  (clone-in/out, lock-free get fast path, dirty-key `Set`). The `flush` row
  measures **flush-rounds/sec**: a batch of `bulkBatch` keys is buffered, then a
  single `flush()` that drains them is timed (so ops/sec there is flushes/sec,
  not key-writes/sec — multiply by `bulkBatch` for key throughput). Both sides
  are measured identically, so the Δ% is apples-to-apples.
- **postgres / mongodb** ops call the driver classes directly (bypassing the
  cache layer) so the prepared statements, batched `doBulk`, and `findKeys`
  query paths are actually exercised.

## Caveat

The `before` worktree installs the lockfile as it was at the baseline commit
(e.g. `mongodb@7.2.0`), while `after` uses the current lockfile (`mongodb@7.3.0`).
Reported deltas reflect ueberDB's own changes **and** any driver-library
minor-version differences. This is the honest "repo then vs now" comparison.
