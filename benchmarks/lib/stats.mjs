// Pure statistics helpers. No I/O. All functions tolerate empty arrays.

export const sum = (xs) => {
  let t = 0;
  for (let i = 0; i < xs.length; i++) t += xs[i];
  return t;
};

export const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);

export const min = (xs) => {
  if (!xs.length) return 0;
  let m = xs[0];
  for (let i = 1; i < xs.length; i++) if (xs[i] < m) m = xs[i];
  return m;
};

// Nearest-rank percentile (1..100). Sorts a copy.
export const percentile = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
};

export const median = (xs) => percentile(xs, 50);

// ops/sec from mean milliseconds-per-op.
export const opsPerSec = (meanMs) => (meanMs > 0 ? 1000 / meanMs : 0);

// Percent change of `after` relative to `before`. Positive = after larger.
// Used on ops/sec, where larger is faster, so positive = improvement.
export const percentDelta = (before, after) =>
  before === 0 ? 0 : ((after - before) / before) * 100;

export const summarize = (samplesMs) => {
  const m = mean(samplesMs);
  return {
    n: samplesMs.length,
    meanMs: m,
    medianMs: median(samplesMs),
    minMs: min(samplesMs),
    p95Ms: percentile(samplesMs, 95),
    opsPerSec: opsPerSec(m),
  };
};
