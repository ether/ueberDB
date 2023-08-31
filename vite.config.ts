import {defineConfig} from "vite";
import dts from "vite-plugin-dts";
import commonjs from '@rollup/plugin-commonjs';
import {glob} from "glob";

export default defineConfig({
  build: {
    lib: {
      entry:  ['./index.ts'].concat(glob.sync('./databases/*.ts')),
      name: 'ueberdb2',
      fileName: (format) => `[name].${format === "cjs" ? "c" : "m"}js`,
      formats: ["cjs"],
    },
    rollupOptions:{
      external: ['console', 'process', 'util', '@aws-crypto/crc32', 'crypto', 'assert'],
      output:{
        preserveModules: true,
        dir: './dist',
        format: 'cjs',
      }
    }
  },
  plugins: [
    dts({
      include:'./index.ts',
      insertTypesEntry: true,
    }),
    commonjs(),
  ],
});
