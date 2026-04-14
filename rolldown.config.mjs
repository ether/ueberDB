import {defineConfig} from 'rolldown';
import path from 'node:path';

export default defineConfig({
  input: ['./index.ts'],
  // Keep third-party modules external for a Node library build.
  external: (id) => !id.startsWith('.') && !path.isAbsolute(id),
  output: {
    dir: './dist',
    format: 'cjs',
    exports: 'named',
  },
});
