import * as ueberdb from "../../index";
import { ConsoleLogger } from "../../lib/logging";
import { afterEach, describe, expect, it } from "vitest";

type MockSettings = { mock?: any };

const logger = new ConsoleLogger();

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

  it("cache-hit get() does not acquire the per-key lock", async () => {
    await createDb({ writeInterval: 1e9 });
    // Prime the cache: a single set+flush is enough to populate the buffer with the value.
    mock.once("set", (k: any, v: any, cb: any) => cb());
    await Promise.all([db.set("k", "v"), db.flush()]);
    // After the write is finished, the buffer holds the value; the lock map is empty.
    const before = { ...db.metrics };
    const val = await db.get("k");
    expect(val).toBe("v");
    const after = db.metrics;
    expect(after.lockAcquires - before.lockAcquires).toBe(0);
    expect(after.lockReleases - before.lockReleases).toBe(0);
    expect(after.readsFromCache - before.readsFromCache).toBe(1);
  });

  it("cache-miss get() still acquires the lock", async () => {
    await createDb({ writeInterval: 1e9 });
    mock.once("get", (k: any, cb: any) => cb(null, "v"));
    const before = { ...db.metrics };
    const val = await db.get("k");
    expect(val).toBe("v");
    const after = db.metrics;
    expect(after.lockAcquires - before.lockAcquires).toBe(1);
    expect(after.lockReleases - before.lockReleases).toBe(1);
  });

  it("get() during a write-in-progress with the lock released returns the buffered value via fast path", async () => {
    await createDb({ writeInterval: 1e9 });
    let releaseWrite: (() => void) | null = null;
    const writeStarted = new Promise<void>((resolve) => {
      mock.once("set", (k: any, v: any, cb: any) => {
        resolve();
        releaseWrite = () => cb();
      });
    });
    const writeP = db.set("k", "v2");
    const flushedP = db.flush();
    await writeStarted;
    // At this moment: _write is awaiting the mock's callback. The per-key lock has been released
    // (set() releases the lock before awaiting entry.dirty). The buffer holds value 'v2'.
    // The fast path must apply.
    // Defensive yield: the lock is released synchronously inside set()'s finally block before
    // _write begins awaiting, so by the time writeStarted fires the lock is already gone.
    // The yield is belt-and-suspenders.
    await new Promise<void>((r) => setImmediate(r));
    const before = { ...db.metrics };
    const val = await db.get("k");
    expect(val).toBe("v2");
    expect(db.metrics.lockAcquires - before.lockAcquires).toBe(0);
    expect(db.metrics.readsFromCache - before.readsFromCache).toBe(1);
    releaseWrite!();
    await Promise.all([writeP, flushedP]);
  });

  it("get() while a setter holds the lock takes the slow path", async () => {
    await createDb({ writeInterval: 1e9 });
    // Hold the first set's database write open so its key-level lock cannot be released
    // — wait, _setLocked releases the lock BEFORE awaiting entry.dirty. We need contention
    // on the _LOCK ITSELF, not on _write. Drive that by holding the FIRST _lock open via
    // an in-flight setSub that does an awaited _getLocked under the lock.
    //
    // Simpler approach: a setSub holds the lock through its entire walk (because it awaits
    // _getLocked under the lock). Pause the mock's get() callback so _getLocked never resolves
    // — this leaves setSub holding the lock indefinitely. Then issue db.get('k'); it must
    // take the slow path and increment lockAwaits.
    let releaseGet: (() => void) | null = null;
    const getStarted = new Promise<void>((resolve) => {
      mock.once("get", (k: any, cb: any) => {
        resolve();
        releaseGet = () => cb(null, null);
      });
    });
    // setSub triggers a get under the lock; that get is paused by our mock, so the lock is held.
    const setSubP = db.setSub("k", ["s"], "v2");
    await getStarted;
    // At this moment: setSub holds the lock on 'k' (still awaiting _getLocked).
    // Issue a get; it must observe _locks.has('k') === true and take the slow path.
    const before = { ...db.metrics };
    const getP = db.get("k");
    // After issuing get, lockAwaits should already be incremented (lock-acquire is sync).
    // But we'll only assert it after we release everything, to avoid a timing race on
    // the synchronous increment.
    mock.on("set", (k: any, v: any, cb: any) => cb()); // for setSub's eventual write
    releaseGet!();
    await Promise.all([setSubP, getP, db.flush()]);
    expect(db.metrics.lockAwaits - before.lockAwaits).toBe(1);
  });
});
