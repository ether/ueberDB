// rollup.config.js
// eslint-disable-next-line strict
const typescript = require('rollup-plugin-typescript2');
const nodeResolve = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');
const json = require('@rollup/plugin-json');
const minify = require('@rollup/plugin-terser');


module.exports = {
  input: ['./index.ts'], // Matches all TypeScript files in the 'src' directory and its subdirectories
  plugins: [
    typescript({
      tsconfig: 'tsconfig.json',
      // rollup-plugin-typescript2@0.36 depends on @rollup/pluginutils@4,
      // whose picomatch doesn't support extglobs — so the plugin's default
      // include pattern (`*.ts+(|x)`) silently matches nothing and every
      // .ts file is skipped, leaving rollup to parse raw TypeScript and
      // crash. Pass explicit globs that pluginutils@4 can handle.
      include: ['*.ts', '**/*.ts'],
      exclude: ['*.d.ts', '**/*.d.ts'],
    }),
    nodeResolve(),
    commonjs(),
    json(),
  ],
  external: ['rusty-store-kv'],
  output: {
    compact: true,
    preserveModules: false,
    dir: './dist',
    format: 'cjs',
  },
};
