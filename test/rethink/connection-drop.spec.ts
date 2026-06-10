import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import Rethink from "../../databases/rethink_db";

// Behavioural regression test for the rethinkdb connection error handler.
//
// The rethinkdb Connection is an EventEmitter that re-emits raw socket errors
// as 'error'. WITHOUT a listener Node treats that as uncaught and crashes the
// process. This driver holds a single connection and does not auto-reconnect,
// so we can't assert recovery — but we CAN assert the crash is prevented: the
// error is caught by the handler and logged.
//
// Verified locally that this FAILS if the connection.on('error', …) handler
// is removed from rethink_db.ts (the re-emitted socket error becomes uncaught
// and kills the worker) and PASSES with it.
describe("rethink connection-drop survival", () => {
  let container: StartedTestContainer;
  let host: string;
  let port: number;
  let driver: InstanceType<typeof Rethink>;
  const loggedErrors: string[] = [];
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (msg: string) => loggedErrors.push(String(msg)),
  };

  beforeAll(async () => {
    container = await new GenericContainer("rethinkdb:2.4.3").withExposedPorts(28015).start();
    host = container.getHost();
    port = container.getMappedPort(28015);
  }, 120000);

  afterAll(async () => {
    // Close the driver (best-effort: the socket may already be destroyed by
    // the test) so no handles leak, then stop the container.
    if (driver) {
      await new Promise<void>((resolve) => {
        const done = setTimeout(resolve, 2000);
        try {
          driver.close(() => {
            clearTimeout(done);
            resolve();
          });
        } catch {
          clearTimeout(done);
          resolve();
        }
      });
    }
    if (container) await container.stop();
  });

  // Clear per attempt: vitest is configured with retries, and a stale entry
  // from a previous attempt must not satisfy this run's "handler fired" check.
  beforeEach(() => {
    loggedErrors.length = 0;
  });

  it("does not crash the process when its connection is dropped", async () => {
    driver = new Rethink({ host, port, db: "test", table: "test" });
    driver.logger = logger;

    await new Promise<void>((resolve, reject) =>
      driver.init((err: Error | null) => (err ? reject(err) : resolve())),
    );

    // Warm: write then read back.
    await new Promise<void>((resolve, reject) =>
      driver.set("dropkey", "before", (err: Error | null) => (err ? reject(err) : resolve())),
    );
    const before = await new Promise((resolve, reject) =>
      driver.get("dropkey", (err: Error | null, v: unknown) => (err ? reject(err) : resolve(v))),
    );
    expect(before).toBe("before");

    // Simulate a network drop: destroy the underlying socket with an error,
    // exactly as a failover / proxy idle-timeout would surface to the client.
    // If the handler is missing, the re-emitted 'error' becomes uncaught here
    // and kills the worker. `rawSocket` is a rethinkdb Connection internal not
    // present in its public types, so this single access is cast.
    const connection = driver.connection as unknown as { rawSocket: { destroy(e: Error): void } };
    connection.rawSocket.destroy(new Error("simulated network drop"));

    // Wait — with a bounded poll rather than a fixed sleep — for the
    // re-emitted 'error' to reach the handler. The process surviving this far
    // and the log appearing both prove the fix; without it the worker dies.
    await waitFor(() => loggedErrors.some((m) => /RethinkDB connection error/.test(m)), 30000);
    expect(loggedErrors.some((m) => /RethinkDB connection error/.test(m))).toBe(true);
  }, 60000);
});

// Poll a predicate until it returns true or the deadline passes.
async function waitFor(predicate: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
