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
    }),
    nodeResolve(),
    commonjs(),
    json(),
  ],
  external: ['better-sqlite3', 'rusty-store-kv'],
  output: {
    compact: true,
    preserveModules: false,
    dir: './dist',
    format: 'cjs',
  },
};
