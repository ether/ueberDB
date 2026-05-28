import assert$0 from "assert";
import * as ueberdb from "../../index";
import { afterAll, describe, it, afterEach, beforeEach, beforeAll, expect } from "vitest";

const assert = assert$0.strict;
describe(__filename, () => {
  let db: any = null;
  beforeAll(async () => {
    db = new ueberdb.Database("memory", {}, {});
    await db.init();
  });
  afterAll(async () => {
    await db.close();
  });
  it("no .toJSON method", async () => {
    await db.set("key", { prop: "value" });
    // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
    assert.deepEqual(await db.get("key"), { prop: "value" });
  });
  it("direct", async () => {
    await db.set("key", { toJSON: (arg: any) => `toJSON ${arg}` });
    // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
    assert.equal(await db.get("key"), "toJSON ");
  });
  it("object property", async () => {
    await db.set("key", { prop: { toJSON: (arg: any) => `toJSON ${arg}` } });
    // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
    assert.deepEqual(await db.get("key"), { prop: "toJSON prop" });
  });
  it("array entry", async () => {
    await db.set("key", [{ toJSON: (arg: any) => `toJSON ${arg}` }]);
    // @ts-expect-error TS(2775): Assertions require every name in the call target t... Remove this comment to see the full error message
    assert.deepEqual(await db.get("key"), ["toJSON 0"]);
  });
  it("object property containing a function survives the round-trip via the cache", async () => {
    // cloneIn preserves functions inside objects (they hit the `typeof !== 'object'` branch and
    // pass through unchanged). cloneOut therefore needs to tolerate function-containing values
    // when reading from the cache; structuredClone would throw DataCloneError without the
    // cloneIn fallback in cloneOut.
    const fn = () => "hello";
    await db.set("key", { fn });
    const out: any = await db.get("key");
    assert.equal(typeof out.fn, "function");
    assert.equal(out.fn(), "hello");
  });
});
