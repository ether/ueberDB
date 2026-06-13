import { performance } from "node:perf_hooks";
import { summarize } from "./stats.mjs";

// Runs `fn(i)` `warmup` times (discarded) then `iters` times (measured).
// `fn` is async; each measured call is timed individually with performance.now().
// Returns { stats } where stats is summarize() over the per-iteration ms samples.
export async function timeLoop({ warmup = 0, iters, fn }) {
  for (let i = 0; i < warmup; i++) await fn(i);
  const samples = new Array(iters);
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    await fn(i);
    samples[i] = performance.now() - t0;
  }
  return { stats: summarize(samples) };
}
