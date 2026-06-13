import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHtml, buildRows } from "./render.mjs";

const before = {
  label: "before",
  targets: { cache: { set: { opsPerSec: 100, medianMs: 10, p95Ms: 12 } } },
};
const after = {
  label: "after",
  targets: { cache: { set: { opsPerSec: 150, medianMs: 6, p95Ms: 7 } } },
};

test("buildRows computes per-op before/after/delta", () => {
  const rows = buildRows("cache", before, after);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].op, "set");
  assert.equal(rows[0].before, 100);
  assert.equal(rows[0].after, 150);
  assert.equal(Math.round(rows[0].deltaPct), 50);
});

test("renderHtml is a self-contained document with svg + table + the op label", () => {
  const html = renderHtml(before, after);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<svg/);
  assert.match(html, /<table/);
  assert.match(html, /set/);
  assert.match(html, /\+50/); // delta rendered with sign
  assert.doesNotMatch(html, /https?:\/\//); // no external resources
});
