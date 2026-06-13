import { afterAll, beforeAll, bench, describe } from "vitest";
import { Database } from "../lib/CacheAndBufferLayer";
import { createMemoryBackend } from "./lib/memory-backend.mjs";

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  isDebugEnabled: () => false,
  isInfoEnabled: () => false,
  isWarnEnabled: () => false,
  isErrorEnabled: () => false,
};

const payload = (i) => ({ a: "x".repeat(64), n: i, nested: { b: i % 7, list: [1, 2, 3] } });
const nextTick = () => new Promise((r) => setImmediate(r));
const NO_AUTO_FLUSH = 3_600_000;
const POP = 20_000;

let setDb;
let hitDb;
let missDb;
let rmDb;
let flushDb;
let bigDb;
let setI = 0;
let hitI = 0;
let missI = 0;
let rmI = 0;
let flushR = 0;
let bigR = 0;

// vitest bench skips describe-level beforeAll/afterAll hooks (vitest 4.1.8 limitation).
// These must live at file scope so @vitest/runner executes them around the file suite.
beforeAll(async () => {
  // set: unbuffered (writeInterval 0) so each awaited set completes at once.
  setDb = new Database(createMemoryBackend(), { cache: 5_000_000, writeInterval: 0 }, noopLogger);
  await setDb.init();

  // getHit: prefill + a priming read pass so timed gets hit the cache fast path.
  hitDb = new Database(createMemoryBackend(), { cache: POP + 10, writeInterval: 0 }, noopLogger);
  await hitDb.init();
  for (let i = 0; i < POP; i++) await hitDb.set("hit:" + i, payload(i));
  for (let i = 0; i < POP; i++) await hitDb.get("hit:" + i);

  // getMiss: keys never written -> falls through to the backend each time.
  missDb = new Database(createMemoryBackend(), { cache: 1000, writeInterval: 0 }, noopLogger);
  await missDb.init();

  // remove: remove(key) is set(key,null); idempotent, no prefill needed.
  rmDb = new Database(createMemoryBackend(), { cache: 5_000_000, writeInterval: 0 }, noopLogger);
  await rmDb.init();

  // flush: small cache, dirty a batch then flush.
  flushDb = new Database(
    createMemoryBackend(),
    { cache: 4000, writeInterval: NO_AUTO_FLUSH },
    noopLogger,
  );
  await flushDb.init();

  // flushBigCache: large mostly-clean cache; flush() iterates the dirty Set
  // instead of scanning the LRU. Prime POP clean entries once.
  bigDb = new Database(
    createMemoryBackend(),
    { cache: POP + 1000, writeInterval: NO_AUTO_FLUSH },
    noopLogger,
  );
  await bigDb.init();
  const prime = [];
  for (let i = 0; i < POP; i++) prime.push(bigDb.set("big:" + i, payload(i)));
  await nextTick();
  await bigDb.flush();
  await Promise.all(prime);
}, 120000);

afterAll(async () => {
  await Promise.all([setDb, hitDb, missDb, rmDb, flushDb, bigDb].map((d) => d && d.close()));
});

describe("cache", () => {
  bench("set", async () => {
    await setDb.set("set:" + setI++, payload(setI));
  });

  bench("getHit", async () => {
    await hitDb.get("hit:" + (hitI++ % POP));
  });

  bench("getMiss", async () => {
    await missDb.get("miss:" + missI++);
  });

  bench("remove", async () => {
    await rmDb.remove("rm:" + rmI++);
  });

  bench("flush", async () => {
    const ps = [];
    for (let j = 0; j < 500; j++) ps.push(flushDb.set(`f:${flushR}:${j}`, payload(j)));
    flushR++;
    await nextTick();
    await flushDb.flush();
    await Promise.all(ps);
  });

  bench("flushBigCache", async () => {
    const ps = [];
    for (let j = 0; j < 10; j++) ps.push(bigDb.set("big:" + ((bigR * 10 + j) % POP), payload(j)));
    bigR++;
    await nextTick();
    await bigDb.flush();
    await Promise.all(ps);
  });
});
