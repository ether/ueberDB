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
