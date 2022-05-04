'use strict';

// This is a workaround for https://github.com/eslint/eslint/issues/3458
require('eslint-config-etherpad/patch/modern-module-resolution');

module.exports = {
  root: true,
  extends: 'etherpad/node',
  overrides: [
    {
      files: [
        'test/**/*',
      ],
      extends: 'etherpad/tests/backend',
      overrides: [
        {
          files: [
            'test/lib/**/*',
          ],
          rules: {
            'mocha/no-exports': 'off',
          },
        },
      ],
    },
  ],
};
