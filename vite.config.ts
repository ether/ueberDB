import {defineConfig} from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  build: {
    minify: false,
    outDir: './dist',
    lib: {
      entry: ['./index.ts'],
      name: 'ueberdb2',
      formats: ["cjs"],
    },
    rollupOptions: {
      external: ['console', 'process', 'util', '@aws-crypto/crc32', 'crypto', 'assert']
    }
  }
});
