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
