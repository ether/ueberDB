import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Convert a `vitest bench --outputJson` report into the github-action-benchmark
// `customBiggerIsBetter` format. We track ops/sec (hz): a DROP is what alerts.
// Bench name is "<describe> / <bench>", derived from the group's fullName
// (which is "<file> > <describe>") plus the bench name.
export function toGab(vitestJson) {
  const out = [];
  for (const file of vitestJson?.files ?? []) {
    for (const group of file?.groups ?? []) {
      const label =
        String(group?.fullName ?? "")
          .split(" > ")
          .pop() || "bench";
      for (const b of group?.benchmarks ?? []) {
        out.push({ name: `${label} / ${b.name}`, unit: "ops/sec", value: b.hz });
      }
    }
  }
  return out;
}

function main() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const input = path.join(dir, "results.json");
  const output = path.join(dir, "output.json");
  const data = JSON.parse(readFileSync(input, "utf8"));
  const gab = toGab(data);
  mkdirSync(dir, { recursive: true });
  writeFileSync(output, JSON.stringify(gab, null, 2));
  console.log(`Wrote ${output} with ${gab.length} benchmark(s)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
