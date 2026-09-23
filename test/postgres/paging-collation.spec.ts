import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import * as ueberdb from "../../index";
import pg from "pg";

// findKeysPaged() pages in JavaScript string order: that is the order the
// CacheAndBufferLayer fallback produces (a plain .sort()), what the mysql
// driver enforces with BINARY, and what callers rely on when they check that
// each page starts after the cursor (Etherpad's SessionStore aborts cleanup
// with "paged cursor did not advance" otherwise).
//
// PostgreSQL compares text with the column's collation. `store` tables created
// by earlier versions inherit the database default, which is usually a
// linguistic one (en_US.utf8 on the official Debian images), and that sorts
// mixed-case keys differently: "XeLu" < "XGeU" linguistically, but
// "XGeU" < "XeLu" in JavaScript. Session IDs are exactly such keys.
//
// An ICU collation is used to simulate that table: it sorts linguistically on
// every platform, unlike libc locales on musl (alpine) or macOS.
describe("postgres findKeysPaged key order", () => {
  let container: StartedTestContainer;
  let host: string;
  let port: number;
  const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

  const connection = () => ({
    user: "ueberdb",
    password: "ueberdb",
    host,
    port,
    database: "ueberdb",
  });

  const admin = async <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> => {
    const client = new pg.Client(connection());
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  };

  const openDb = async () => {
    const db = new ueberdb.Database(
      "postgres",
      connection(),
      { cache: 0, writeInterval: 0 },
      logger,
    );
    await db.init();
    return db;
  };

  beforeAll(async () => {
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

  it("pages in JavaScript order when store.key has a linguistic collation", async () => {
    await admin(async (c) => {
      await c.query("DROP TABLE IF EXISTS store");
      await c.query(
        "CREATE TABLE store (" +
          '"key" character varying(100) COLLATE "en-US-x-icu" NOT NULL, ' +
          '"value" text NOT NULL, ' +
          "CONSTRAINT store_pkey PRIMARY KEY (key))",
      );
    });
    const db = await openDb();
    try {
      const keys = ["a", "B", "Xa", "XeLu", "XGeU", "xg", "Z", "_"].map((s) => `sess:${s}`);
      for (const k of keys) await db.set(k, 1);

      const collected: string[] = [];
      let after: string | undefined;
      for (let safety = 0; safety < 20; safety++) {
        const page: string[] = await db.findKeysPaged("sess:*", null, {
          limit: 2,
          ...(after != null ? { after } : {}),
        });
        if (page.length === 0) break;
        // The invariant callers check before trusting the cursor.
        if (after != null) expect(page[0] > after).toBe(true);
        collected.push(...page);
        after = page[page.length - 1];
      }
      expect(collected).toStrictEqual([...keys].sort());
    } finally {
      await db.close();
    }
  }, 60000);

  it('creates new store tables with COLLATE "C"', async () => {
    await admin((c) => c.query("DROP TABLE IF EXISTS store"));
    const db = await openDb();
    try {
      const { rows } = await admin((c) =>
        c.query(
          "SELECT collation_name FROM information_schema.columns " +
            "WHERE table_name = 'store' AND column_name = 'key'",
        ),
      );
      expect(rows[0].collation_name).toBe("C");
    } finally {
      await db.close();
    }
  }, 60000);
});
