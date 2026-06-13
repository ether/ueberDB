import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Node strips TS types but does NOT resolve extensionless relative imports
// (e.g. `../lib/AbstractDatabase`). This sync resolve hook appends `.ts` when
// that resolves to a real file, so the library's TS source graph loads with no
// build step. Registered in-thread via registerHooks (load with `node --import`).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[mc]?[jt]s$/.test(specifier)) {
      try {
        const candidate = new URL(specifier + ".ts", context.parentURL);
        if (existsSync(fileURLToPath(candidate))) {
          return nextResolve(specifier + ".ts", context);
        }
      } catch {}
    }
    return nextResolve(specifier, context);
  },
});
