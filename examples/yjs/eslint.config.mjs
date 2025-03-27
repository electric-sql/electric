import prettier from "eslint-plugin-prettier"
import globals from "globals"
import tsParser from "@typescript-eslint/parser"
import path from "node:path"
import { fileURLToPath } from "node:url"
import js from "@eslint/js"
import { FlatCompat } from "@eslint/eslintrc"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

export default [
  {
    ignores: [
      `**/node_modules/**/*`,
      `**/dist/**/*`,
      `.next/**/*`,
      `.sst/**/*`,
      `build/**/*`,
      `**/tsup.config.ts`,
      `**/vitest.config.ts`,
      `**/.eslintrc.js`,
      `**/*.css`,
    ],
  },
  ...compat.extends(
    `eslint:recommended`,
    `plugin:@typescript-eslint/recommended`,
    `plugin:prettier/recommended`,
    `plugin:@next/next/recommended`
  ),
  {
    plugins: {
      prettier,
    },

    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },

      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: `module`,

      parserOptions: {
        requireConfigFile: false,

        ecmaFeatures: {
          jsx: true,
        },
      },
    },

    rules: {
      quotes: [`error`, `backtick`],
      "no-unused-vars": `off`,

      "@typescript-eslint/no-unused-vars": [
        `error`,
        {
          argsIgnorePattern: `^_`,
          varsIgnorePattern: `^_`,
          caughtErrorsIgnorePattern: `^_`,
        },
      ],

      "@next/next/no-img-element": `off`,
    },
  },
]
