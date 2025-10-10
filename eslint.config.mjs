import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'

export default [
  {
    ignores: [
      `**/.sst/**`,
      `**/node_modules/**`,
      `**/dist/**`,
      `**/build/**`,
      `**/coverage/**`,
      `**/.next/**`,
      `**/.nitro/**`,
      `**/.output/**`,
      `**/.vitepress/cache/**`,
      `**/.vitepress/dist/**`,
      `**/sst-env.d.ts`,
      `**/sst.config.ts`,
      `examples/**`,
    ],
  },
  {
    files: [`**/*.{js,mjs,cjs,jsx}`],
    rules: {
      quotes: [`error`, `backtick`],
    },
  },
  {
    files: [`**/*.{ts,tsx}`],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: `latest`,
        sourceType: `module`,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      quotes: [`error`, `backtick`],
    },
  },
  {
    files: [`**/*.d.ts`],
    rules: {
      quotes: `off`,
    },
  },
]
