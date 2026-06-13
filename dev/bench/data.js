window.BENCHMARK_DATA = {
  "lastUpdate": 1781385532375,
  "repoUrl": "https://github.com/ether/ueberDB",
  "entries": {
    "ueberDB benchmarks": [
      {
        "commit": {
          "author": {
            "email": "40429738+SamTV12345@users.noreply.github.com",
            "name": "SamTV12345",
            "username": "SamTV12345"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "d7d60305c408ac17ce354eed38a9dfdcf4c2b34a",
          "message": "Perf/vitest bench ci (#1017)\n\n* docs(bench): design spec for vitest-bench CI regression tracking\n\nAdds a permanent CI job running vitest bench across cache+PG+Mongo,\ntracked over time via github-action-benchmark (history + alert on drop).\nComplements the existing before/after harness. Keep both.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\n\n* docs(bench): implementation plan for vitest-bench CI tracking\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\n\n* feat(bench): vitest cache benches + benchmark config/scripts\n\n* docs(bench): file-scope hooks in bench plan (vitest skips describe hooks)\n\nvitest bench 4.1.8 does not run beforeAll/afterAll declared inside a\ndescribe block (benches read NaN). Move hooks + shared state to file\nscope; keep bench() calls inside describe. Applies to all three bench\nfiles.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\n\n* feat(bench): vitest postgres driver benches (testcontainers)\n\n* feat(bench): vitest mongo driver benches (testcontainers)\n\n* feat(bench): vitest-json -> github-action-benchmark adapter + bench:ci\n\n* ci(bench): track vitest benchmarks via github-action-benchmark\n\n* docs(bench): flag the cache getHit regression in README\n\nFinal review (C-1): the chart must not read as a uniform speedup. The\ncache commit traded cache-hit read throughput (-58%, structuredClone on\nthe read path) for the flush/doBulk wins; the lock-free get win needs\nconcurrency this sequential bench doesn't exercise.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\n\n* ci(bench): run benchmark job on push only (least privilege + fix gh-pages)\n\nQodo flagged that the benchmark job granted contents: write on all events\nincluding pull_request, exposing a write-scoped token to PR-controlled code.\nIt also failed on PRs because github-action-benchmark unconditionally fetches\nthe (not-yet-existent) gh-pages branch (`couldn't find remote ref gh-pages`).\n\nPer the action's own guidance, run tracking ONLY on pushes to the default\nbranch: PRs never hold the write token and never fetch gh-pages, and history\nis persisted on push. Drops pull-requests:write and the auto-push expression.\ngh-pages must be created once (documented in the job comment).\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\n\n* perf(bench): bound bench keyspaces for a stable regression signal\n\nQodo flagged that set/remove (cache) and set/doBulk (PG/Mongo) used\never-increasing keys, so the cache/backing Map and the DB table/collection\ngrew throughout a run — changing the workload (and memory) mid-measurement\nand weakening the regression signal. Cycle keys over a bounded keyspace so\nthe dataset reaches steady state and each iteration measures the same work.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\n\n---------\n\nCo-authored-by: Claude Opus 4.8 (1M context) <noreply@anthropic.com>",
          "timestamp": "2026-06-13T23:09:20+02:00",
          "tree_id": "420a83c69bb5f3fcffcbf0ff6ce8d851a3e4d8d3",
          "url": "https://github.com/ether/ueberDB/commit/d7d60305c408ac17ce354eed38a9dfdcf4c2b34a"
        },
        "date": 1781385532115,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "cache / set",
            "value": 112550.93022586714,
            "unit": "ops/sec"
          },
          {
            "name": "cache / getHit",
            "value": 285419.2978685321,
            "unit": "ops/sec"
          },
          {
            "name": "cache / getMiss",
            "value": 592799.5608224153,
            "unit": "ops/sec"
          },
          {
            "name": "cache / remove",
            "value": 92667.13189429864,
            "unit": "ops/sec"
          },
          {
            "name": "cache / flush",
            "value": 531.2197041258829,
            "unit": "ops/sec"
          },
          {
            "name": "cache / flushBigCache",
            "value": 7246.162894813069,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / set",
            "value": 2327.0052378388623,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / get",
            "value": 2729.4802742021084,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / findKeys",
            "value": 142.84390825567547,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / doBulk",
            "value": 350.8809515218247,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / remove",
            "value": 2900.251084790033,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / set",
            "value": 2918.5637981032714,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / get",
            "value": 4337.817889729137,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / findKeys",
            "value": 906.7731721689656,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / doBulk",
            "value": 312.48518991867684,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / remove",
            "value": 3363.138343776877,
            "unit": "ops/sec"
          }
        ]
      }
    ]
  }
}