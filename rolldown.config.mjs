import {defineConfig} from 'rolldown';
import path from 'node:path';

export default defineConfig({
  input: ['./index.ts'],
  // Keep third-party modules external for a Node library build.
  external: (id) => !id.startsWith('.') && !path.isAbsolute(id),
  output: {
    // Preserve module structure so that dynamic imports of database drivers
    // remain as separate chunks — this allows lazy-loading to work correctly
    // and avoids eagerly requiring optional dependencies like cassandra-driver.
    preserveModules: true,
    dir: './dist',
    format: 'cjs',
    exports: 'named',
  },
});
