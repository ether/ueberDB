import * as ueberdb from "../../index";
import { ConsoleLogger } from "../../lib/logging";
import { afterEach, describe, expect, it } from "vitest";

type MockSettings = { mock?: any };

const logger = new ConsoleLogger();

const dirtyKeys = (db: any): Set<string> => (db.db as any)._dirtyKeys;

describe(__filename, () => {
  let db: any = null;
  let mock: any = null;

  const createDb = async (wrapperSettings: Record<string, unknown> = {}) => {
    const settings: MockSettings = {};
    db = new ueberdb.Database("mock", settings, { json: false, ...wrapperSettings }, logger);
    await db.init();
    mock = settings.mock;
    mock.once("init", (cb: any) => cb());
  };

  afterEach(async () => {
    if (mock != null) {
      mock.removeAllListeners();
      mock.once("close", (cb: any) => cb());
      mock = null;
    }
    if (db != null) {
      await db.close();
      db = null;
    }
  });

  it("set() adds the key to _dirtyKeys; flush() drains it", async () => {
    // writeInterval=1e9 means the lazy flush timer effectively never fires; we drive flush manually.
    await createDb({ writeInterval: 1e9 });
    mock.on("set", (k: any, v: any, cb: any) => cb());
    const writeP = db.set("k", "v");
    // _setLocked is reached via `await this._lock(key)` which (with no contention) resolves
    // as a microtask. setImmediate fires after the microtask queue is fully drained, so
    // _dirtyKeys.add(key) and buffer.set(key, entry) have both completed by the time we resume.
    await new Promise((r) => setImmediate(r));
    expect(dirtyKeys(db).has("k")).toBe(true);
    expect(dirtyKeys(db).size).toBe(1);
    await Promise.all([writeP, db.flush()]);
    expect(dirtyKeys(db).size).toBe(0);
  });

  it("re-set during an in-flight write keeps the key in _dirtyKeys", async () => {
    await createDb({ writeInterval: 1e9 });
    let releaseFirstWrite: (() => void) | null = null;
    const firstWriteSeen = new Promise<void>((resolve) => {
      mock.once("set", (k: any, v: any, cb: any) => {
        resolve();
        releaseFirstWrite = () => cb();
      });
    });
    const firstWriteP = db.set("k", "v1");
    const flushedP = db.flush();
    await firstWriteSeen;
    // While the first write is in flight, queue a second write to the same key.
    let releaseSecondWrite: (() => void) | null = null;
    const secondWriteSeen = new Promise<void>((resolve) => {
      mock.once("set", (k: any, v: any, cb: any) => {
        resolve();
        releaseSecondWrite = () => cb();
      });
    });
    const secondWriteP = db.set("k", "v2");
    // The key must remain in _dirtyKeys: the old in-flight entry is being written,
    // and a new dirty entry has taken its place in the buffer.
    expect(dirtyKeys(db).has("k")).toBe(true);
    // Release the first write. markDone for v1 will run, hit the reference-equality guard,
    // and see that the buffer entry is no longer v1's — so the key MUST remain in _dirtyKeys.
    releaseFirstWrite!();
    await new Promise((r) => setImmediate(r));
    expect(dirtyKeys(db).has("k")).toBe(true);
    // Wait for the second write to be picked up by the flush loop.
    await secondWriteSeen;
    releaseSecondWrite!();
    await Promise.all([firstWriteP, secondWriteP, flushedP]);
    // Drain any remaining dirty entry (the v2 write) — it may have been picked up by the
    // same flush() loop, but to be robust against scheduling we call flush() once more.
    await db.flush();
    expect(dirtyKeys(db).size).toBe(0);
  });

  it("failed write removes the key from _dirtyKeys and rejects the caller", async () => {
    await createDb({ writeInterval: 1e9 });
    mock.on("set", (k: any, v: any, cb: any) => cb(new Error("boom")));
    const writeP = db.set("k", "v");
    const flushedP = db.flush();
    await expect(writeP).rejects.toThrow("boom");
    await flushedP;
    expect(dirtyKeys(db).size).toBe(0);
  });
});
