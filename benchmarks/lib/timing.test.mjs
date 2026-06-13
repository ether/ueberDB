import { test } from "node:test";
import assert from "node:assert/strict";
import { timeLoop } from "./timing.mjs";

test("runs warmup + iters times and returns a stats summary", async () => {
  let calls = 0;
  const { stats } = await timeLoop({
    warmup: 3,
    iters: 10,
    fn: async () => { calls++; },
  });
  assert.equal(calls, 13); // warmup + measured
  assert.equal(stats.n, 10); // only measured iters counted
  assert.ok(stats.meanMs >= 0);
  assert.ok(stats.opsPerSec >= 0);
});

test("passes the iteration index to fn", async () => {
  const seen = [];
  await timeLoop({ warmup: 0, iters: 4, fn: async (i) => { seen.push(i); } });
  assert.deepEqual(seen, [0, 1, 2, 3]);
});
