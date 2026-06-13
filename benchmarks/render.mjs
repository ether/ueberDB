import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { percentDelta } from "./lib/stats.mjs";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => (n >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toFixed(1));
const sign = (n) => (n >= 0 ? "+" : "") + n.toFixed(1);

// All ops present in either side, in a stable order.
function opsFor(target, before, after) {
  const b = before.targets?.[target] ?? {};
  const a = after.targets?.[target] ?? {};
  return [...new Set([...Object.keys(b), ...Object.keys(a)])];
}

export function buildRows(target, before, after) {
  const b = before.targets?.[target] ?? {};
  const a = after.targets?.[target] ?? {};
  return opsFor(target, before, after).map((op) => {
    const bo = b[op]?.opsPerSec ?? 0;
    const ao = a[op]?.opsPerSec ?? 0;
    return {
      op,
      before: bo,
      after: ao,
      deltaPct: percentDelta(bo, ao),
      beforeMedianMs: b[op]?.medianMs ?? 0,
      afterMedianMs: a[op]?.medianMs ?? 0,
    };
  });
}

function svgChart(target, rows) {
  const W = 720, rowH = 46, padL = 120, padR = 80, padT = 30, barH = 14, gap = 6;
  const H = padT + rows.length * rowH + 20;
  const maxOps = Math.max(1, ...rows.flatMap((r) => [r.before, r.after]));
  const scale = (v) => (v / maxOps) * (W - padL - padR);
  const parts = [`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(target)} ops/sec">`];
  parts.push(`<text x="${padL}" y="18" font-size="13" font-weight="bold">${esc(target)} — ops/sec (higher is better)</text>`);
  rows.forEach((r, i) => {
    const y = padT + i * rowH;
    parts.push(`<text x="${padL - 8}" y="${y + 14}" font-size="12" text-anchor="end">${esc(r.op)}</text>`);
    // before bar (gray)
    parts.push(`<rect x="${padL}" y="${y}" width="${scale(r.before).toFixed(1)}" height="${barH}" fill="#9aa0a6"/>`);
    parts.push(`<text x="${padL + scale(r.before) + 4}" y="${y + 12}" font-size="10" fill="#444">${esc(fmt(r.before))}</text>`);
    // after bar (blue)
    const y2 = y + barH + gap;
    parts.push(`<rect x="${padL}" y="${y2}" width="${scale(r.after).toFixed(1)}" height="${barH}" fill="#1a73e8"/>`);
    parts.push(`<text x="${padL + scale(r.after) + 4}" y="${y2 + 12}" font-size="10" fill="#1a73e8">${esc(fmt(r.after))} (${sign(r.deltaPct)}%)</text>`);
  });
  parts.push(`</svg>`);
  return parts.join("\n");
}

function table(target, rows) {
  const head = `<tr><th>op</th><th>before ops/s</th><th>after ops/s</th><th>Δ%</th><th>before median ms</th><th>after median ms</th></tr>`;
  const body = rows.map((r) =>
    `<tr><td>${esc(r.op)}</td><td>${esc(fmt(r.before))}</td><td>${esc(fmt(r.after))}</td>` +
    `<td class="${r.deltaPct >= 0 ? "up" : "down"}">${sign(r.deltaPct)}%</td>` +
    `<td>${r.beforeMedianMs.toFixed(4)}</td><td>${r.afterMedianMs.toFixed(4)}</td></tr>`
  ).join("\n");
  return `<h2>${esc(target)}</h2><table>${head}${body}</table>`;
}

export function renderHtml(before, after) {
  const targets = [...new Set([...Object.keys(before.targets ?? {}), ...Object.keys(after.targets ?? {})])];
  const sections = targets.map((t) => {
    const rows = buildRows(t, before, after);
    return `<section>${svgChart(t, rows)}${table(t, rows)}</section>`;
  }).join("\n");
  const meta = `before: ${esc(before.label)} @ ${esc(before.commit ?? "?")} · after: ${esc(after.label)} @ ${esc(after.commit ?? "?")}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ueberDB perf: before vs after</title>
<style>
body{font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif;margin:24px;color:#202124}
h1{font-size:20px} h2{font-size:15px;margin:18px 0 6px}
section{margin-bottom:28px;border-bottom:1px solid #eee;padding-bottom:12px}
table{border-collapse:collapse;font-size:12px} td,th{border:1px solid #ddd;padding:4px 8px;text-align:right}
th:first-child,td:first-child{text-align:left}
.up{color:#137333;font-weight:bold} .down{color:#c5221f;font-weight:bold}
.note{color:#5f6368;font-size:12px}
</style></head><body>
<h1>ueberDB performance — before vs after</h1>
<p class="note">${meta}</p>
<p class="note">Gray = before, blue = after. Δ% on ops/sec (positive = faster). Driver libs differ by their per-commit lockfile (e.g. mongodb minor version); see README.</p>
${sections}
</body></html>`;
}

// CLI: node benchmarks/render.mjs
function main() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(dir, "out");
  const before = JSON.parse(readFileSync(path.join(out, "before.json"), "utf8"));
  const after = JSON.parse(readFileSync(path.join(out, "after.json"), "utf8"));
  const html = renderHtml(before, after);
  writeFileSync(path.join(dir, "results.html"), html);
  writeFileSync(path.join(dir, "results.json"), JSON.stringify({ before, after }, null, 2));
  console.log("Wrote benchmarks/results.html and benchmarks/results.json");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
