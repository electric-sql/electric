<<<<<<< HEAD
const config = require('../../common/.eslintrc.cjs')
module.exports = config
=======
module.exports = {
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  root: true,
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'warn', // or "error"
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
    '@typescript-eslint/no-explicit-any': ['warn', { ignoreRestArgs: true }],
    '@typescript-eslint/ban-ts-comment': [
      'error',
      { 'ts-ignore': 'allow-with-description' },
    ],
    'no-constant-condition': ['error', { checkLoops: false }],
  },
  ignorePatterns: ['**/*/mock.ts'],
}
>>>>>>> 06a17acb2 (Extract CLI to separate package)
