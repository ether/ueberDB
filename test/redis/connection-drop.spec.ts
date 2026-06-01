import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
      await admin.sendCommand(["CLIENT", "KILL", "TYPE", "normal"]);
      await admin.quit();

      // Allow the 'error' event to fire and the client to reconnect.
      await new Promise((r) => setTimeout(r, 1000));

      // 1) The handler caught the dropped-connection error (proves the fix ran).
      expect(loggedErrors.some((m) => /Redis client error/.test(m))).toBe(true);

      // 2) The client recovered: a fresh round-trip works.
      await db.set("dropkey", "after");
      expect(await db.get("dropkey")).toBe("after");
    } finally {
      await db.close();
    }
  }, 60000);
});
