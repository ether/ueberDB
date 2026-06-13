import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCacheBench } from "./cache-bench.mjs";
import { runPgBench } from "./pg-bench.mjs";
import { runMongoBench } from "./mongo-bench.mjs";

const env = process.env;
const root = env.UEBERDB_ROOT || process.cwd();
const label = env.BENCH_LABEL || "after";
const commit = env.BENCH_COMMIT || "";
const targets = (env.BENCH_TARGETS || "cache")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Size overrides (small values used for smoke runs).
const sizes = {
  iters: env.BENCH_ITERS ? Number(env.BENCH_ITERS) : undefined,
  warmup: env.BENCH_WARMUP ? Number(env.BENCH_WARMUP) : undefined,
  bulkRounds: env.BENCH_BULK_ROUNDS ? Number(env.BENCH_BULK_ROUNDS) : undefined,
  bulkBatch: env.BENCH_BULK_BATCH ? Number(env.BENCH_BULK_BATCH) : undefined,
};
const opts = Object.fromEntries(Object.entries(sizes).filter(([, v]) => v !== undefined));

async function main() {
  const out = { label, commit, node: process.version, targets: {} };

  if (targets.includes("cache")) {
    console.error(`[${label}] cache ...`);
    out.targets.cache = await runCacheBench(root, opts);
  }
  if (targets.includes("pg")) {
    console.error(`[${label}] postgres ...`);
    out.targets.postgres = await runPgBench(
      root,
      {
        host: env.PG_HOST,
        port: Number(env.PG_PORT),
        user: env.PG_USER,
        password: env.PG_PASSWORD,
        database: env.PG_DATABASE,
      },
      opts,
    );
  }
  if (targets.includes("mongo")) {
    console.error(`[${label}] mongo ...`);
    out.targets.mongodb = await runMongoBench(
      root,
      {
        url: env.MONGO_URL,
        database: env.MONGO_DATABASE,
      },
      opts,
    );
  }

  const dir = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.join(dir, "out");
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${label}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.error(`[${label}] wrote ${file}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
