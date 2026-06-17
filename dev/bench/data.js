window.BENCHMARK_DATA = {
  "lastUpdate": 1781723797950,
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
      },
      {
        "commit": {
          "author": {
            "email": "john@mclear.co.uk",
            "name": "John McLear",
            "username": "JohnMcLear"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "c6bc61139e44fccf2f38773113994052490c615b",
          "message": "test: guard that an open Database keeps the host event loop alive (#1022)\n\nFor years the cache layer created an always-on, *referenced* `setInterval`\nflush timer in its constructor, which had the side effect of anchoring the\nhost process's event loop for as long as a Database was open. Consumers\n(notably Etherpad) relied on this implicitly: during the window between \"DB\ninitialised\" and \"HTTP server listening\" nothing else holds the loop open, so\nwhen the cache-layer rewrite replaced that referenced timer with a\nlazily-armed, `.unref()`'d `setTimeout` (armed only while there are dirty\nkeys), a freshly-opened write-free Database stopped anchoring the loop — and\nthe consumer's process exits 0 *mid-startup*, before it can bind a port or\nserve traffic. This silently broke Etherpad's packaged (.deb/systemd) boot.\n\nThis adds a regression test for that contract. It must run in a SEPARATE\nprocess — a same-process test runner keeps its own loop alive and can never\nobserve the loop draining. The child opens a Database, goes idle, and unref's\nits own stdio so that ueberdb's flush machinery is the *only* thing that can\nkeep it alive; the parent asserts the child stays running rather than exiting\non its own. The child loads the TS source graph with no build step via the\nexisting benchmarks/register-ts.mjs hook.\n\nNOTE: this test is RED on current main — the regression is present. It is\nintentionally test-only (no fix) to lock in the contract. It goes green once\nthe cache layer restores a referenced keepalive (released on close()).\n\nCo-authored-by: Claude Opus 4.8 (1M context) <noreply@anthropic.com>",
          "timestamp": "2026-06-16T11:53:59+01:00",
          "tree_id": "c70a2f0ff99312da39e557c643af04691e4bcb64",
          "url": "https://github.com/ether/ueberDB/commit/c6bc61139e44fccf2f38773113994052490c615b"
        },
        "date": 1781607296668,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "cache / set",
            "value": 114905.41210030603,
            "unit": "ops/sec"
          },
          {
            "name": "cache / getHit",
            "value": 305113.25674410304,
            "unit": "ops/sec"
          },
          {
            "name": "cache / getMiss",
            "value": 672814.8185373205,
            "unit": "ops/sec"
          },
          {
            "name": "cache / remove",
            "value": 85062.96869604681,
            "unit": "ops/sec"
          },
          {
            "name": "cache / flush",
            "value": 537.9007049867561,
            "unit": "ops/sec"
          },
          {
            "name": "cache / flushBigCache",
            "value": 7403.111096392245,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / set",
            "value": 2322.603919945354,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / get",
            "value": 2713.4980734074393,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / findKeys",
            "value": 143.19361461009984,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / doBulk",
            "value": 261.5233506793266,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / remove",
            "value": 2874.430704556744,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / set",
            "value": 2730.4945090864608,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / get",
            "value": 4020.456787866507,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / findKeys",
            "value": 782.3176087713498,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / doBulk",
            "value": 308.39518915124575,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / remove",
            "value": 3233.2328573063633,
            "unit": "ops/sec"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "40429738+samtv12345@users.noreply.github.com",
            "name": "SamTV12345",
            "username": "SamTV12345"
          },
          "committer": {
            "email": "40429738+samtv12345@users.noreply.github.com",
            "name": "SamTV12345",
            "username": "SamTV12345"
          },
          "distinct": true,
          "id": "1e3d457c2c0cb46834bde646408cd5894fed4bdd",
          "message": "fix: fixed event loop hanging",
          "timestamp": "2026-06-17T21:09:26+02:00",
          "tree_id": "ba3eb5e2f82dad505902718615cd132bb268cfc0",
          "url": "https://github.com/ether/ueberDB/commit/1e3d457c2c0cb46834bde646408cd5894fed4bdd"
        },
        "date": 1781723416323,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "cache / set",
            "value": 114169.20034286722,
            "unit": "ops/sec"
          },
          {
            "name": "cache / getHit",
            "value": 280103.8907594857,
            "unit": "ops/sec"
          },
          {
            "name": "cache / getMiss",
            "value": 662246.6278247774,
            "unit": "ops/sec"
          },
          {
            "name": "cache / remove",
            "value": 93333.84067072734,
            "unit": "ops/sec"
          },
          {
            "name": "cache / flush",
            "value": 494.70415708979436,
            "unit": "ops/sec"
          },
          {
            "name": "cache / flushBigCache",
            "value": 7176.410740782969,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / set",
            "value": 2181.651965425077,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / get",
            "value": 2561.5442602913754,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / findKeys",
            "value": 137.41656444600278,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / doBulk",
            "value": 249.17164928403136,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / remove",
            "value": 2730.181295190531,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / set",
            "value": 2539.586565465335,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / get",
            "value": 3821.674530910215,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / findKeys",
            "value": 764.5046899867748,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / doBulk",
            "value": 299.5852541741314,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / remove",
            "value": 2763.810043335684,
            "unit": "ops/sec"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "40429738+samtv12345@users.noreply.github.com",
            "name": "SamTV12345",
            "username": "SamTV12345"
          },
          "committer": {
            "email": "40429738+samtv12345@users.noreply.github.com",
            "name": "SamTV12345",
            "username": "SamTV12345"
          },
          "distinct": true,
          "id": "eb5d66cba93f8ffcdeb56f4b903471c5515c2f69",
          "message": "fix: fixed pnpm lockfile and dependabot",
          "timestamp": "2026-06-17T21:15:28+02:00",
          "tree_id": "8441b525a72e8ada7f9be0ed3c175e4aca3db779",
          "url": "https://github.com/ether/ueberDB/commit/eb5d66cba93f8ffcdeb56f4b903471c5515c2f69"
        },
        "date": 1781723797341,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "cache / set",
            "value": 109449.96020197078,
            "unit": "ops/sec"
          },
          {
            "name": "cache / getHit",
            "value": 341569.1802339914,
            "unit": "ops/sec"
          },
          {
            "name": "cache / getMiss",
            "value": 625561.3293982227,
            "unit": "ops/sec"
          },
          {
            "name": "cache / remove",
            "value": 92183.01253028672,
            "unit": "ops/sec"
          },
          {
            "name": "cache / flush",
            "value": 570.9212648232841,
            "unit": "ops/sec"
          },
          {
            "name": "cache / flushBigCache",
            "value": 9291.163535128831,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / set",
            "value": 2886.781893512383,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / get",
            "value": 3895.9946780710693,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / findKeys",
            "value": 155.4706274884609,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / doBulk",
            "value": 406.632027239039,
            "unit": "ops/sec"
          },
          {
            "name": "mongodb / remove",
            "value": 4042.7581374695637,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / set",
            "value": 2567.5230569169275,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / get",
            "value": 6879.361787848668,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / findKeys",
            "value": 1041.5889993967244,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / doBulk",
            "value": 353.47978239034614,
            "unit": "ops/sec"
          },
          {
            "name": "postgres / remove",
            "value": 3245.9133600792484,
            "unit": "ops/sec"
          }
        ]
      }
    ]
  }
}