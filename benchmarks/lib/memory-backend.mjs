// Minimal async key/value backend backed by a Map, for benchmarking the
// CacheAndBufferLayer in isolation. Mirrors the method surface the cache layer
// expects from an async wrapped DB.

// Matches AbstractDatabase.createFindRegex semantics closely enough for bench.
const globToRegExp = (key, notKey) => {
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  let re = `^(?=${esc(key)}$)`;
  if (notKey != null) re += `(?!${esc(notKey)}$)`;
  return new RegExp(re);
};

export function createMemoryBackend() {
  const data = new Map();
  return {
    _data: data,
    get isAsync() {
      return true;
    },
    settings: {},
    logger: undefined,
    async init() {},
    async close() {
      data.clear();
    },
    async get(key) {
      return data.get(key);
    },
    async set(key, value) {
      data.set(key, value);
    },
    async remove(key) {
      data.delete(key);
    },
    async findKeys(key, notKey) {
      const re = globToRegExp(key, notKey);
      const out = [];
      for (const k of data.keys()) if (re.test(k)) out.push(k);
      return out;
    },
    async findKeysPaged(key, notKey, options) {
      const all = (await this.findKeys(key, notKey)).sort();
      const after = options?.after;
      const start = after != null ? all.findIndex((k) => k > after) : 0;
      const from = start < 0 ? all.length : start;
      return all.slice(from, from + (options?.limit ?? all.length));
    },
    async doBulk(ops) {
      for (const op of ops) {
        if (op.type === "set") data.set(op.key, op.value);
        else if (op.type === "remove") data.delete(op.key);
      }
    },
  };
}
