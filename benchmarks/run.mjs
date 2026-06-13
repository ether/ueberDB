import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GenericContainer, Wait } from "testcontainers";

const BEFORE_COMMIT = process.env.BEFORE_COMMIT || "809bcc2";
const AFTER_COMMIT = process.env.AFTER_COMMIT || "HEAD";
const TARGETS = process.env.BENCH_TARGETS || "cache,pg,mongo";

const benchDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(benchDir, "..");
const harness = path.join(benchDir, "harness.mjs");
// Registers a resolve hook so the driver .ts sources (which use extensionless
// runtime relative imports like `../lib/AbstractDatabase`) load with no build.
const registerTs = pathToFileURL(path.join(benchDir, "register-ts.mjs")).href;
const beforeRoot = path.resolve(repoRoot, "..", "ueberDB-bench-before");

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
const gitRev = (ref) => execFileSync("git", ["rev-parse", "--short", ref], { cwd: repoRoot }).toString().trim();

function setupBeforeWorktree() {
  if (!existsSync(beforeRoot)) {
    console.error(`> git worktree add ${beforeRoot} ${BEFORE_COMMIT}`);
    sh("git", ["worktree", "add", "--detach", beforeRoot, BEFORE_COMMIT], repoRoot);
  } else {
    console.error(`> reusing existing worktree ${beforeRoot}`);
  }
  console.error(`> pnpm install (before) ...`);
  sh("pnpm", ["install", "--frozen-lockfile"], beforeRoot);
}

function runHarness(label, root, commit, extraEnv) {
  console.error(`\n=== harness: ${label} (${commit}) ===`);
  const res = spawnSync("node", ["--import", registerTs, harness], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, UEBERDB_ROOT: root, BENCH_LABEL: label, BENCH_COMMIT: commit, BENCH_TARGETS: TARGETS, ...extraEnv },
  });
  if (res.status !== 0) throw new Error(`harness ${label} failed with code ${res.status}`);
}

async function main() {
  const wantPg = TARGETS.includes("pg");
  const wantMongo = TARGETS.includes("mongo");
  let pg, mongo, connEnv = {};

  setupBeforeWorktree();

  if (wantPg) {
    console.error(`> starting postgres:14-alpine ...`);
    pg = await new GenericContainer("postgres:14-alpine")
      .withEnvironment({ POSTGRES_USER: "ueberdb", POSTGRES_PASSWORD: "ueberdb", POSTGRES_DB: "ueberdb", POSTGRES_HOST_AUTH_METHOD: "trust" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    connEnv = { ...connEnv, PG_HOST: pg.getHost(), PG_PORT: String(pg.getMappedPort(5432)), PG_USER: "ueberdb", PG_PASSWORD: "ueberdb", PG_DATABASE: "ueberdb" };
  }
  if (wantMongo) {
    console.error(`> starting mongo ...`);
    mongo = await new GenericContainer("mongo")
      .withExposedPorts(27017)
      .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
      .start();
    connEnv = { ...connEnv, MONGO_URL: `mongodb://${mongo.getHost()}:${mongo.getMappedPort(27017)}/?directConnection=true`, MONGO_DATABASE: "ueberdb_bench" };
  }

  try {
    // Run AFTER first against the live containers, then BEFORE against the same containers.
    runHarness("after", repoRoot, gitRev(AFTER_COMMIT), connEnv);
    runHarness("before", beforeRoot, gitRev(BEFORE_COMMIT), connEnv);
    console.error(`\n> rendering report ...`);
    sh("node", [path.join(benchDir, "render.mjs")], repoRoot);
    console.error(`\nDone. Open benchmarks/results.html`);
  } finally {
    if (pg) await pg.stop();
    if (mongo) await mongo.stop();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
