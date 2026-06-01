import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import * as ueberdb from "../../index";
import pg from "pg";

// Behavioural regression test for the pool error handler (ether/etherpad#7878).
//
// The shallow version of this test only checked that a listener was attached.
// This one reproduces the actual failure: warm pooled connections sit idle,
// something external (here: `pg_terminate_backend`, exactly what a Patroni
// failover or an HAProxy `timeout server` does) drops them, and the idle `pg`
// client emits an 'error'. WITHOUT the pool error handler that becomes an
// uncaught EventEmitter 'error' and crashes the process; the recovery query
// below would never run and this worker would die. WITH the handler the drop
// is logged and the pool transparently reconnects.
//
// Crucially: this test FAILS if the `db.on('error', …)` handler is removed
// from postgres_db.ts (verified locally) — that's what makes it a real
// regression test rather than a wiring assertion.
describe("postgres connection-drop recovery", () => {
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
    // Dynamic mapped port (not a hardcoded host binding) so this is safe to
    // run concurrently and in CI without port conflicts.
    container = await new GenericContainer("postgres:alpine3.21")
      .withExposedPorts(5432)
      .withEnvironment({
        POSTGRES_USER: "ueberdb",
        POSTGRES_PASSWORD: "ueberdb",
        POSTGRES_DB: "ueberdb",
      })
      .start();
    host = container.getHost();
    port = container.getMappedPort(5432);
  }, 120000);

  afterAll(async () => {
    if (container) await container.stop();
  });

  it("survives idle backend connections being terminated and recovers", async () => {
    const db = new ueberdb.Database(
      "postgres",
      {
        user: "ueberdb",
        password: "ueberdb",
        host,
        port,
        database: "ueberdb",
        // Keep connections warm and effectively un-reaped by the client so we
        // can be sure it's *our* termination that drops the idle sockets.
        min: 2,
        max: 4,
        idleTimeoutMillis: 600000,
      },
      // Hit the DB directly — no read cache / write buffer in the way.
      { cache: 0, writeInterval: 0 },
      logger,
    );
    await db.init();

    try {
      // Warm the pool and prove it works.
      await db.set("dropkey", "before");
      expect(await db.get("dropkey")).toBe("before");

      // Let the connections settle back to idle in the pool.
      await new Promise((r) => setTimeout(r, 500));

      // Kill every backend except our own admin connection — this is what a
      // failover / proxy idle-timeout does to the pool's idle sockets.
      const admin = new pg.Client({
        user: "ueberdb",
        password: "ueberdb",
        host,
        port,
        database: "ueberdb",
      });
      await admin.connect();
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity " +
          "WHERE datname = current_database() AND pid <> pg_backend_pid()",
      );
      await admin.end();

      // Give the idle 'error' events time to propagate to the pool handler.
      await new Promise((r) => setTimeout(r, 1000));

      // 1) The handler caught the dropped-connection error (proves the fix ran).
      expect(loggedErrors.some((m) => /Postgres idle client error/.test(m))).toBe(true);

      // 2) The pool recovered: a fresh query round-trips correctly.
      await db.set("dropkey", "after");
      expect(await db.get("dropkey")).toBe("after");
    } finally {
      await db.close();
    }
  }, 60000);
});
