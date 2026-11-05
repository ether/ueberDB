// Live SQL Server test for the MSSQL adapter's doBulk() parameter binding.
//
// MSSQL is not in the CI container matrix, so this suite is skipped unless MSSQL_TEST_HOST is set,
// for example:
//   docker run -d -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD='Str0ng!Passw0rd' -p 1433:1433 \
//     mcr.microsoft.com/mssql/server:2022-latest
//   MSSQL_TEST_HOST=127.0.0.1 MSSQL_TEST_PASSWORD='Str0ng!Passw0rd' pnpm exec vitest run test/mssql
// The suite creates its own throwaway database and drops it afterwards, so it never touches
// existing tables.

import mssql from "mssql";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Database } from "../../index";

const host = process.env.MSSQL_TEST_HOST;

const settings = {
  host,
  port: Number(process.env.MSSQL_TEST_PORT ?? 1433),
  user: process.env.MSSQL_TEST_USER ?? "sa",
  password: process.env.MSSQL_TEST_PASSWORD ?? "",
  options: { trustServerCertificate: true, encrypt: false },
};

const TEST_DB = `ueberdb_test_${process.pid}_${Date.now()}`;
const CANARY = "ueberdb_bulk_canary";

describe.skipIf(!host)(__filename, () => {
  let admin: mssql.ConnectionPool;
  let db: any = null;

  const canaryExists = async () =>
    (await admin.request().query(`SELECT OBJECT_ID(N'dbo.${CANARY}', N'U') AS id`)).recordset[0]
      .id != null;

  beforeAll(async () => {
    const master = await new mssql.ConnectionPool({
      ...settings,
      server: host!,
      database: "master",
    } as any).connect();
    await master.request().query(`CREATE DATABASE [${TEST_DB}]`);
    await master.close();
    admin = await new mssql.ConnectionPool({
      ...settings,
      server: host!,
      database: TEST_DB,
    } as any).connect();
  });

  afterAll(async () => {
    await admin?.close();
    const master = await new mssql.ConnectionPool({
      ...settings,
      server: host!,
      database: "master",
    } as any).connect();
    await master
      .request()
      .query(
        `IF DB_ID(N'${TEST_DB}') IS NOT NULL BEGIN ALTER DATABASE [${TEST_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${TEST_DB}] END`,
      );
    await master.close();
  });

  afterEach(async () => {
    if (db != null) await db.close();
    db = null;
    await admin
      .request()
      .query(`IF OBJECT_ID(N'dbo.${CANARY}', N'U') IS NOT NULL DROP TABLE ${CANARY}`);
    await admin.request().query("IF OBJECT_ID(N'dbo.store', N'U') IS NOT NULL DROP TABLE [store]");
  });

  // The adapter itself defaults to writeInterval 0, which never batches. A host that passes
  // wrapper settings with a write interval (as the reporter describes) reaches doBulk().
  const openBuffered = async () => {
    db = new Database("mssql", { ...settings, database: TEST_DB }, { writeInterval: 50, cache: 0 });
    await db.init();
    return db;
  };

  it("does not execute stacked queries smuggled in a removed key", async () => {
    await openBuffered();
    await db.set("pad:a", "1");
    await db.set("pad:b", "2");
    const retriedBefore = db.metrics.writesToDbRetried;
    const evil = `x'); CREATE TABLE ${CANARY} (a INT); --`;
    await Promise.all([db.remove(evil), db.remove("pad:a"), db.remove("pad:b")]);
    expect(db.metrics.writesToDbRetried).toBe(retriedBefore); // the bulk path really ran
    expect(await canaryExists()).toBe(false);
    expect(await db.get("pad:a")).toBeNull();
    expect(await db.get("pad:b")).toBeNull();
  });

  it("does not execute stacked queries smuggled in a set key or value", async () => {
    await openBuffered();
    const evilKey = `k', 'v') s ON 1=0 WHEN NOT MATCHED THEN INSERT ([key],[value]) VALUES ('a','b'); CREATE TABLE ${CANARY} (a INT); --`;
    const evilValue = `v'); CREATE TABLE ${CANARY} (a INT); --`;
    const retriedBefore = db.metrics.writesToDbRetried;
    await Promise.all([
      db.set(evilKey.slice(0, 100), "x"),
      db.set("pad:quoted", evilValue),
      db.set("pad:plain", "it's fine"),
    ]);
    expect(db.metrics.writesToDbRetried).toBe(retriedBefore);
    expect(await canaryExists()).toBe(false);
    expect(await db.get(evilKey.slice(0, 100))).toBe("x");
    expect(await db.get("pad:quoted")).toBe(evilValue);
    expect(await db.get("pad:plain")).toBe("it's fine");
  });

  it("round-trips a large bulk (more ops than one chunk) through doBulk", async () => {
    await openBuffered();
    const n = 450;
    const retriedBefore = db.metrics.writesToDbRetried;
    await Promise.all(
      [...Array(n).keys()].map((i) => db.set(`bulk:${i}`, { i, s: `quote ' ${i}` })),
    );
    expect(db.metrics.writesToDbRetried).toBe(retriedBefore);
    expect(await db.get("bulk:0")).toEqual({ i: 0, s: "quote ' 0" });
    expect(await db.get(`bulk:${n - 1}`)).toEqual({ i: n - 1, s: `quote ' ${n - 1}` });
    expect((await db.findKeys("bulk:*", null)).length).toBe(n);
    await Promise.all([...Array(n).keys()].map((i) => db.remove(`bulk:${i}`)));
    expect((await db.findKeys("bulk:*", null)).length).toBe(0);
  });

  it("falls back per-op for an over-long key without breaking the other writes", async () => {
    await openBuffered();
    const results = await Promise.allSettled([
      db.set("k".repeat(101), "too long"),
      db.set("pad:ok", "fine"),
    ]);
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("fulfilled");
    expect(await db.get("pad:ok")).toBe("fine");
  });
});
