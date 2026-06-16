// Child process for ./test_event_loop_keepalive.spec.ts.
//
// Opens a Database and then goes completely idle. It deliberately does NOT
// arm any keepalive of its own: it even unref()'s its stdio so that the ONLY
// thing capable of keeping this process's event loop alive is ueberdb's
// internal flush machinery. If an open Database stops anchoring the loop, node
// has nothing left to do and exits 0 right here -- which is the regression the
// parent spec asserts against.
//
// Run via: node --import ../../benchmarks/register-ts.mjs keepalive-child.ts
// (the register-ts hook loads the TS source graph with no build step).

import * as ueberdb from "../../index";
import { ConsoleLogger } from "../../lib/logging";

// writeInterval > 0 is the realistic production config (Etherpad uses 100ms).
// The "mock" driver holds no handles of its own, so it isolates the cache
// layer's loop-anchoring behaviour from any per-driver socket/file handle.
const db = new ueberdb.Database(
  "mock",
  {},
  { writeInterval: 100, json: false },
  new ConsoleLogger(),
);

await db.init();

process.stdout.write("READY\n");

// Drop every handle this process owns. A piped stdout/stderr (or an IPC
// channel, if the parent used fork) is itself a referenced handle that would
// keep the loop alive and mask the bug. After this, only ueberdb can.
process.stdout.unref?.();
process.stderr.unref?.();
(process as unknown as { channel?: { unref?: () => void } }).channel?.unref?.();
