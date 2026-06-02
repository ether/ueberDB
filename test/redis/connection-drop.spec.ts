import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import * as ueberdb from "../../index";
import { createClient } from "redis";

// Behavioural regression test for the redis client error handler.
//
// node-redis emits connection/socket errors as an EventEmitter 'error'.
// WITHOUT a listener Node treats it as uncaught and crashes the process (and
// node-redis won't reconnect). This test warms the client, then kills its
// connection server-side with CLIENT KILL (what a failover / proxy idle
// timeout does), and asserts the handler caught it and the client recovered.
//
// Verified locally that this FAILS if the client.on('error', …) handler is
// removed from redis_db.ts (the dropped-socket error becomes uncaught and
// kills the worker) and PASSES with it.
describe("redis connection-drop recovery", () => {
  let container: StartedTestContainer;
  let host: string;
  let port: number;
  const loggedErrors: string[] = [];
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (msg: string) => loggedErrors.push(String(msg)),
  };

  beforeAll(async () => {
    // Dynamic mapped port so this is safe to run alongside the other redis
    // spec (which binds 6379) and in CI without conflicts.
    container = await new GenericContainer("redis:bookworm").withExposedPorts(6379).start();
    host = container.getHost();
    port = container.getMappedPort(6379);
  }, 120000);

  afterAll(async () => {
    if (container) await container.stop();
  });

  // Clear per attempt: vitest is configured with retries, and a stale entry
  // from a previous attempt must not satisfy this run's "handler fired" check.
  beforeEach(() => {
    loggedErrors.length = 0;
  });

  it("survives its connection being killed and recovers", async () => {
    const db = new ueberdb.Database(
      "redis",
      { host, port },
      { cache: 0, writeInterval: 0 },
      logger,
    );
    await db.init();

    try {
      await db.set("dropkey", "before");
      expect(await db.get("dropkey")).toBe("before");

      // Kill the driver's connection from a separate admin client. SKIPME
      // (default yes) means the admin's own connection is spared.
      const admin = createClient({ socket: { host, port } });
      await admin.connect();
      try {
        await admin.sendCommand(["CLIENT", "KILL", "TYPE", "normal"]);
      } finally {
        await admin.quit().catch(() => admin.destroy?.());
      }

      // Wait — with a bounded poll rather than a fixed sleep — for the client
      // to recover (node-redis reconnects after the dropped socket). The
      // round-trip succeeds as soon as recovery happens; it only fails on a
      // real timeout, so this is deterministic rather than race-prone.
      await waitFor(async () => {
        await db.set("dropkey", "after");
        return (await db.get("dropkey")) === "after";
      }, 30000);

      // 1) The handler caught the dropped-connection error (proves the fix ran).
      expect(loggedErrors.some((m) => /Redis client error/.test(m))).toBe(true);
      // 2) The client recovered (asserted again for an explicit signal).
      expect(await db.get("dropkey")).toBe("after");
    } finally {
      await db.close();
    }
  }, 60000);
});

// Poll an async predicate until it returns true or the deadline passes.
// Errors from the predicate are treated as "not ready yet" and retried; the
// most recent one is surfaced (with its stack) if we time out.
async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
      lastErr = undefined; // a clean (but not-yet-true) attempt clears stale errors
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const detail =
    lastErr instanceof Error ? (lastErr.stack ?? lastErr.message) : String(lastErr ?? "");
  throw new Error(`waitFor timed out after ${timeoutMs}ms${detail ? `: ${detail}` : ""}`);
}
