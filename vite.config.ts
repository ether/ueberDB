import {defineConfig} from "vite";
import dts from "vite-plugin-dts";
import commonjs from '@rollup/plugin-commonjs';
import {glob} from "glob";

export default defineConfig({
  build: {
    minify: false,
    lib: {
      entry:  ['./index.ts'],
      name: 'ueberdb2',
      formats: ["cjs"],
    },
    rollupOptions:{
      external: ['console', 'process', 'util', '@aws-crypto/crc32', 'crypto', 'assert'],
      output:{
        preserveModules: false,
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
