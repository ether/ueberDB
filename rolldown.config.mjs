import { defineConfig } from "rolldown";
import path from "node:path";

export default defineConfig({
  input: ["./index.ts"],
  external: (id) => !id.startsWith(".") && !path.isAbsolute(id),
  output: {
    dir: "./dist",
    format: "esm",
    exports: "named",
  },
});
