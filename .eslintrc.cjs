'use strict';

// This is a workaround for https://github.com/eslint/eslint/issues/3458
require('eslint-config-etherpad/patch/modern-module-resolution');

module.exports = {
  parserOptions: {
    project: ['./tsconfig.json'],
  },

  root: true,
  extends: 'etherpad/node',

  rules: {
    'mocha/no-exports': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    'max-len': 'off',
    '@typescript-eslint/restrict-template-expressions': 'off',
    '@typescript-eslint/no-unsafe-member-access': 'off',
    'n/no-missing-import': 'off',
    'strict': 'off',
    '@typescript-eslint/no-unsafe-return': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unsafe-argument': 'off',
    '@typescript-eslint/no-unsafe-assignment': 'off',
    'prefer-arrow/prefer-arrow-functions': 'off',
    '@typescript-eslint/await-thenable': 'off',
    '@typescript-eslint/brace-style': 'off',
    '@typescript-eslint/comma-spacing': 'off',
    '@typescript-eslint/consistent-type-assertions': 'off',
    '@typescript-eslint/consistent-type-definitions': 'off',
    '@typescript-eslint/default-param-last': 'off',
    '@typescript-eslint/dot-notation': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-member-accessibility': 'off',
    'func-call-spacing': 'off',
    '@typescript-eslint/no-floating-promises': 'off',
    'camelcase': 'off',
    'n/no-unpublished-import': 'off',
    'n/no-unpublished-require': 'off',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/restrict-plus-operands': 'off',
  },
  overrides: [
    {
      files: [
        'lib/**/*',
        'databases/**/*',
        'tests/**/*',
      ],
      extends: 'etherpad/tests/backend',
      overrides: [
        {
          files: [
            'lib/**/*',
            'databases/**/*',
            'tests/**/*',
          ],

        },
      ],
    },
  ],
};
