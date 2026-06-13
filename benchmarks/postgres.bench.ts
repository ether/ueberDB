import { afterAll, beforeAll, bench, describe } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { promisify } from "node:util";
import PgDb from "../databases/postgres_db";

const val = JSON.stringify({ a: "x".repeat(64), n: 1 });
const SEED = 2000;

let container: StartedTestContainer;
let db: any;
let set: any;
let get: any;
let findKeys: any;
let doBulk: any;
let remove: any;
let close: any;
let setI = 0;
let getI = 0;
let rmI = 0;
let bulkR = 0;

// File-scope hooks: vitest bench skips describe-level beforeAll/afterAll (4.1.8).
beforeAll(async () => {
  container = await new GenericContainer("postgres:14-alpine")
    .withExposedPorts(5432)
    .withEnvironment({
      POSTGRES_USER: "ueberdb",
      POSTGRES_PASSWORD: "ueberdb",
      POSTGRES_DB: "ueberdb",
      POSTGRES_HOST_AUTH_METHOD: "trust",
    })
    .start();
  db = new PgDb({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: "ueberdb",
    password: "ueberdb",
    database: "ueberdb",
  });
  const init = promisify(db.init.bind(db));
  set = promisify(db.set.bind(db));
  get = promisify(db.get.bind(db));
  findKeys = promisify(db.findKeys.bind(db));
  doBulk = promisify(db.doBulk.bind(db));
  remove = promisify(db.remove.bind(db));
  close = promisify(db.close.bind(db));
  await init();
  // Seed rows so get/findKeys have stable data to read.
  const ops = [];
  for (let i = 0; i < SEED; i++) ops.push({ type: "set", key: "seed:" + i, value: val });
  await doBulk(ops);
}, 120000);

afterAll(async () => {
  if (close) await close();
  if (container) await container.stop();
});

describe("postgres", () => {
  bench("set", async () => {
    await set("set:" + setI++, val);
  });

  bench("get", async () => {
    await get("seed:" + (getI++ % SEED));
  });

  bench("findKeys", async () => {
    await findKeys("seed:*", null);
  });

  bench("doBulk", async () => {
    const ops = [];
    for (let j = 0; j < 100; j++) ops.push({ type: "set", key: `bulk:${bulkR}:${j}`, value: val });
    bulkR++;
    await doBulk(ops);
  });

  bench("remove", async () => {
    await remove("set:" + rmI++);
  });
});
