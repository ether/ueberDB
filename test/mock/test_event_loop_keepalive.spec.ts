// Regression test: an *open* Database must keep the host process's event loop
// alive (until close()).
//
// For years ueberdb's cache layer created an always-on, *referenced*
// `setInterval` flush timer in its constructor, which had the side effect of
// anchoring the host event loop for as long as the Database was open.
// Consumers (e.g. Etherpad) relied on this implicitly: during the window
// between "DB initialised" and "HTTP server listening" nothing else holds the
// loop open, so if ueberdb stops anchoring it, node's loop drains and the
// process exits 0 *mid-startup* -- before it can bind a port or serve traffic.
//
// A later cache-layer rewrite replaced that referenced `setInterval` with a
// lazily-armed, `.unref()`'d `setTimeout` that only exists while there are
// dirty keys. On a freshly-opened, write-free Database there are no dirty keys,
// so no timer is armed and the anchoring behaviour silently disappeared --
// turning a downstream production boot into a clean early exit.
//
// This must be checked in a SEPARATE process: a same-process test runner keeps
// its own event loop alive, so it can never observe the loop draining. The
// child opens a Database, goes idle, and unref()'s its own stdio; if the open
// Database keeps the loop alive the child stays running, otherwise it exits 0.

import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe(__filename, () => {
  it("keeps the host event loop alive while open (no silent early exit after init)", async () => {
    const registerTs = pathToFileURL(
      path.join(__dirname, "..", "..", "benchmarks", "register-ts.mjs"),
    ).href;
    const childPath = path.join(__dirname, "keepalive-child.ts");

    const proc = spawn(process.execPath, ["--import", registerTs, childPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    proc.stdout.on("data", (d) => (output += d.toString()));
    proc.stderr.on("data", (d) => (output += d.toString()));

    // Attach the exit listener immediately (before any await) so an exit that
    // happens between "init done" and the survival check below is never missed.
    let exitInfo: { code: number | null; signal: string | null } | null = null;
    const exited = new Promise<void>((resolve) =>
      proc.on("exit", (code, signal) => {
        exitInfo = { code, signal };
        resolve();
      }),
    );

    // 1) Wait for the child to finish init (prints READY) -- or die trying.
    //    A child that dies before READY is a genuine init failure, reported here.
    await Promise.race([
      (async () => {
        while (!output.includes("READY") && exitInfo == null) await sleep(50);
      })(),
      sleep(15000),
    ]);
    expect(
      output,
      `child never reached READY (Database init failed or process died early):\n${output}`,
    ).toContain("READY");

    // 2) Now that it is open and idle, it MUST stay alive. With the regression
    //    (unref'd flush timer + no dirty keys) the loop drains and it exits 0.
    const fate = await Promise.race([
      exited.then(() => "exited" as const),
      sleep(3000).then(() => "alive" as const),
    ]);
    proc.kill("SIGKILL");

    expect(
      fate,
      "An open Database stopped anchoring the event loop: the child process " +
        `exited on its own after init (${JSON.stringify(exitInfo)}). This is the ` +
        "unref'd-flush-timer regression that lets a consumer exit mid-startup " +
        `before it can bind/serve.\n${output}`,
    ).toBe("alive");
  });
});
