import { afterAll, beforeAll, bench, describe } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { promisify } from "node:util";
import MongoDb from "../databases/mongodb_db";

const val = JSON.stringify({ a: "x".repeat(64), n: 1 });
const SEED = 2000;
// Bounded keyspaces so set/doBulk upsert over a fixed set of docs instead of
// inserting ever-new ones — keeps the collection size (and so each iteration's
// workload) constant for a stable regression signal.
const KS = 5000; // set/remove keyspace
const BR = 50; // doBulk round-buckets (BR * 100 = 5000 keys)

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
  container = await new GenericContainer("mongo").withExposedPorts(27017).start();
  const url = `mongodb://${container.getHost()}:${container.getMappedPort(27017)}/?directConnection=true`;
  db = new MongoDb({ url, database: "ueberdb_bench", collection: "ueberdb_bench" });
  const init = promisify(db.init.bind(db));
  set = promisify(db.set.bind(db));
  get = promisify(db.get.bind(db));
  findKeys = promisify(db.findKeys.bind(db));
  doBulk = promisify(db.doBulk.bind(db));
  remove = promisify(db.remove.bind(db));
  close = promisify(db.close.bind(db));
  await init();
  const ops = [];
  for (let i = 0; i < SEED; i++) ops.push({ type: "set", key: "seed:" + i, value: val });
  await doBulk(ops);
}, 120000);

afterAll(async () => {
  if (close) await close();
  if (container) await container.stop();
});

describe("mongodb", () => {
  bench("set", async () => {
    await set("set:" + (setI++ % KS), val);
  });

  bench("get", async () => {
    await get("seed:" + (getI++ % SEED));
  });

  bench("findKeys", async () => {
    await findKeys("seed:*", null);
  });

  bench("doBulk", async () => {
    const ops = [];
    const r = bulkR++ % BR;
    for (let j = 0; j < 100; j++) ops.push({ type: "set", key: `bulk:${r}:${j}`, value: val });
    await doBulk(ops);
  });

  bench("remove", async () => {
    await remove("set:" + (rmI++ % KS));
  });
});
