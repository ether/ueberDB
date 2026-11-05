// Regression tests for GHSA-xmqq-59rx-x7pf: the MSSQL adapter's doBulk() used to interpolate keys
// and values straight into the T-SQL text. These tests need no SQL Server; they capture the SQL
// and the bound parameters the adapter hands to the mssql driver. (Lives under test/mock/ so the
// `mock` CI matrix job runs it.) The live-server counterpart is test/mssql/test.mssql.spec.ts.

import mssql from "mssql";
import { afterEach, describe, expect, it, vi } from "vitest";
import MSSQL, { buildBulkStatements, MSSQL_BULK_CHUNK_SIZE } from "../../databases/mssql_db";

const INJECTION_KEY = "x'); DROP TABLE [store]; --";
const INJECTION_VALUE = "'+(SELECT TOP 1 name FROM sys.databases)+'";

type Captured = { sql: string; inputs: Record<string, unknown> };

const captureRequests = () => {
  const captured: Captured[] = [];
  vi.spyOn(mssql, "Request").mockImplementation(function (this: any) {
    const inputs: Record<string, unknown> = {};
    const run = (sql: string, cb: (err: any, res?: any) => void) => {
      captured.push({ sql, inputs });
      setImmediate(() => cb(null, { rowsAffected: [1] }));
    };
    return {
      input: (name: string, _type: unknown, value: unknown) => {
        inputs[name] = value;
      },
      query: run,
      batch: run,
    } as any;
  } as any);
  return captured;
};

const runDoBulk = (db: MSSQL, bulk: any[]) =>
  new Promise<any>((resolve, reject) => {
    db.doBulk(bulk, ((err: any, res: any) => (err ? reject(err) : resolve(res))) as any);
  });

describe(__filename, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("buildBulkStatements", () => {
    it("never puts keys or values in the SQL text", () => {
      const statements = buildBulkStatements([
        { type: "set", key: INJECTION_KEY, value: INJECTION_VALUE },
        { type: "set", key: "pad:ok", value: 'it\'s "quoted"' },
        { type: "remove", key: INJECTION_KEY },
      ]);
      expect(statements).toHaveLength(2);
      for (const { sql } of statements) {
        expect(sql).not.toContain(INJECTION_KEY);
        expect(sql).not.toContain(INJECTION_VALUE);
        expect(sql).not.toContain("pad:ok");
        expect(sql).not.toContain("'");
      }
      const [merge, del] = statements;
      expect(merge.sql).toContain("SELECT @k0 [key], @v0 [value]");
      expect(merge.sql).toContain("SELECT @k1 [key], @v1 [value]");
      expect(merge.params).toEqual([
        { name: "k0", kind: "key", value: INJECTION_KEY },
        { name: "v0", kind: "value", value: INJECTION_VALUE },
        { name: "k1", kind: "key", value: "pad:ok" },
        { name: "v1", kind: "value", value: 'it\'s "quoted"' },
      ]);
      expect(del.sql).toBe("DELETE FROM [store] WHERE [key] IN (@r0);");
      expect(del.params).toEqual([{ name: "r0", kind: "removeKey", value: INJECTION_KEY }]);
    });

    it("chunks large bulks so no request exceeds the 2100-parameter limit", () => {
      const bulk: any[] = [];
      for (let i = 0; i < 250; i++) bulk.push({ type: "set", key: `k${i}`, value: `v${i}` });
      for (let i = 0; i < 150; i++) bulk.push({ type: "remove", key: `r${i}` });
      const statements = buildBulkStatements(bulk);
      const sets = statements.filter((s) => s.sql.includes("MERGE"));
      const removes = statements.filter((s) => s.sql.startsWith("DELETE"));
      expect(sets.map((s) => s.params.length)).toEqual([200, 200, 100]);
      expect(removes.map((s) => s.params.length)).toEqual([100, 50]);
      for (const s of statements) {
        expect(s.params.length).toBeLessThanOrEqual(2 * MSSQL_BULK_CHUNK_SIZE);
        expect(new Set(s.params.map((p) => p.name)).size).toBe(s.params.length);
      }
      // Every op is represented exactly once.
      expect(
        sets.flatMap((s) => s.params.filter((p) => p.kind === "key").map((p) => p.value)),
      ).toEqual(bulk.slice(0, 250).map((op) => op.key));
      expect(removes.flatMap((s) => s.params.map((p) => p.value))).toEqual(
        bulk.slice(250).map((op) => op.key),
      );
    });

    it("wraps each set chunk in its own transaction", () => {
      const [stmt] = buildBulkStatements([{ type: "set", key: "a", value: "1" }]);
      expect(stmt.sql.startsWith("SET XACT_ABORT ON;\nBEGIN TRANSACTION;\n")).toBe(true);
      expect(stmt.sql.endsWith("\nCOMMIT TRANSACTION;")).toBe(true);
    });

    it("rejects over-long set keys instead of letting them be truncated", () => {
      expect(() =>
        buildBulkStatements([{ type: "set", key: "k".repeat(101), value: "v" }]),
      ).toThrow(/100 chars/);
      expect(() =>
        buildBulkStatements([{ type: "set", key: "k".repeat(100), value: "v" }]),
      ).not.toThrow();
    });

    it("rejects unknown op types", () => {
      expect(() => buildBulkStatements([{ type: "bogus", key: "a" } as any])).toThrow(/unknown op/);
    });

    it("returns no statements for an empty bulk", () => {
      expect(buildBulkStatements([])).toEqual([]);
    });
  });

  describe("MSSQL#doBulk", () => {
    it("sends keys and values only as bound parameters", async () => {
      const captured = captureRequests();
      const db = new MSSQL({});
      await runDoBulk(db, [
        { type: "set", key: INJECTION_KEY, value: INJECTION_VALUE },
        { type: "set", key: "pad:b", value: "{}" },
        { type: "remove", key: INJECTION_KEY },
        { type: "remove", key: "pad:c" },
      ]);
      expect(captured.length).toBeGreaterThan(0);
      for (const { sql } of captured) {
        expect(sql).not.toContain(INJECTION_KEY);
        expect(sql).not.toContain(INJECTION_VALUE);
        expect(sql).not.toContain("pad:b");
        expect(sql).not.toContain("pad:c");
      }
      const bound = captured.flatMap((c) => Object.values(c.inputs));
      expect(bound).toEqual(
        expect.arrayContaining([INJECTION_KEY, INJECTION_VALUE, "pad:b", "{}", "pad:c"]),
      );
    });

    it("reports an over-long key as an error (so the cache layer retries per op)", async () => {
      const captured = captureRequests();
      const db = new MSSQL({});
      await expect(
        runDoBulk(db, [{ type: "set", key: "k".repeat(101), value: "v" }]),
      ).rejects.toThrow(/100 chars/);
      expect(captured).toHaveLength(0);
    });

    it("calls back exactly once when a statement fails", async () => {
      vi.spyOn(mssql, "Request").mockImplementation(function (this: any) {
        return {
          input: () => {},
          query: (_sql: string, cb: any) => setImmediate(() => cb(new Error("boom"))),
        } as any;
      } as any);
      const db = new MSSQL({});
      const cb = vi.fn();
      db.doBulk(
        [
          { type: "set", key: "a", value: "1" },
          { type: "remove", key: "b" },
        ],
        cb as any,
      );
      await new Promise((r) => setTimeout(r, 20));
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0]).toBeInstanceOf(Error);
    });
  });
});
