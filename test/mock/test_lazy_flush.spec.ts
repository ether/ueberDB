import * as ueberdb from "../../index";
import { ConsoleLogger } from "../../lib/logging";
import { afterEach, describe, expect, it } from "vitest";

type MockSettings = { mock?: any };

const logger = new ConsoleLogger();

const flushTimer = (db: any): unknown => (db.db as any)._flushTimer;

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

  it("idle database does not arm the flush timer", async () => {
    await createDb({ writeInterval: 50 });
    expect(flushTimer(db)).toBe(null);
    // Give the event loop a tick or two to confirm nothing schedules itself.
    await new Promise((r) => setTimeout(r, 30));
    expect(flushTimer(db)).toBe(null);
  });

  it("set() arms the timer; flush() leaves it null after draining", async () => {
    await createDb({ writeInterval: 1e9 }); // huge interval so the timer cannot fire during the test
    mock.on("set", (k: any, v: any, cb: any) => cb());
    const writeP = db.set("k", "v");
    await new Promise((r) => setImmediate(r));
    // _setLocked runs after `await this._lock(key)`. setImmediate fires after the
    // microtask queue is drained, so by the time we resume, _scheduleFlush() has fired.
    expect(flushTimer(db)).not.toBe(null);
    await Promise.all([writeP, db.flush()]);
    // After an explicit flush() that drained everything, the timer must be null.
    expect(flushTimer(db)).toBe(null);
  });

  it("close() clears a pending flush timer", async () => {
    await createDb({ writeInterval: 1e9 });
    mock.on("set", (k: any, v: any, cb: any) => cb());
    void db.set("k", "v");
    // Yield so _setLocked runs and arms the timer.
    await new Promise((r) => setImmediate(r));
    // Timer must be armed before close().
    expect(flushTimer(db)).not.toBe(null);
    mock.once("close", (cb: any) => cb());
    // close() must cancel the timer itself (no explicit flush() before this call) and complete cleanly.
    await db.close();
    expect(flushTimer(db)).toBe(null);
    db = null; // prevent afterEach from double-closing
  });

  it("writeInterval=0 mode never arms the timer", async () => {
    await createDb({ writeInterval: 0 });
    mock.on("set", (k: any, v: any, cb: any) => cb());
    await db.set("k", "v");
    expect(flushTimer(db)).toBe(null);
  });
});
