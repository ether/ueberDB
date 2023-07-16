// rollup.config.js
// eslint-disable-next-line strict
const typescript = require('rollup-plugin-typescript2');
const glob = require('glob');
const nodeResolve = require('@rollup/plugin-node-resolve').default;

module.exports = {
  input: ['./index.ts'].concat(glob.sync('./databases/*.ts')).concat(glob.sync('./test/*.ts')), // Matches all TypeScript files in the 'src' directory and its subdirectories
  plugins: [
    typescript({
      tsconfig: 'tsconfig.json',
    }),
  ],
  output: {
    preserveModules: true,
    dir: './dist',
    format: 'cjs'
  }
};
