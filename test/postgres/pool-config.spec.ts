import { describe, it, expect } from "vitest";
import PostgresDB from "../../databases/postgres_db";

// These tests exercise pool *configuration* only. `new pg.Pool()` does not
// open a socket until the first query, so no running PostgreSQL is required.
describe("postgres pool configuration (no DB required)", () => {
  it("enables TCP keep-alive by default so proxies/firewalls don't silently drop idle connections", () => {
    const driver = new PostgresDB({ host: "127.0.0.1", port: 5432 });
    expect(driver.settings.keepAlive).toBe(true);
    expect(driver.settings.keepAliveInitialDelayMillis).toBe(10000);
  });

  it("lets callers override the keep-alive defaults", () => {
    const driver = new PostgresDB({
      host: "127.0.0.1",
      port: 5432,
      keepAlive: false,
      keepAliveInitialDelayMillis: 30000,
    });
    expect(driver.settings.keepAlive).toBe(false);
    expect(driver.settings.keepAliveInitialDelayMillis).toBe(30000);
  });

  it("attaches a pool error handler so a dropped idle connection does not crash the process", () => {
    const driver = new PostgresDB({ host: "127.0.0.1", port: 5432 });
    expect(driver.db.listenerCount("error")).toBeGreaterThanOrEqual(1);
    // Emitting an 'error' with a listener present must NOT throw. Without a
    // listener, Node would rethrow this as an uncaught exception and exit.
    expect(() =>
      driver.db.emit("error", new Error("Connection terminated unexpectedly")),
    ).not.toThrow();
  });
});
