import js from "@eslint/js"
import tsParser from "@typescript-eslint/parser"
import tsPlugin from "@typescript-eslint/eslint-plugin"
import reactPlugin from "eslint-plugin-react"
import prettierPlugin from "eslint-plugin-prettier"
import prettierConfig from "eslint-config-prettier"
import globals from "globals"
import { includeIgnoreFile } from "@eslint/compat"
import { fileURLToPath } from "url"

const gitignorePath = fileURLToPath(new URL(".gitignore", import.meta.url))

export default [
  includeIgnoreFile(gitignorePath, "Imported .gitignore patterns"),
  {
    files: ["src/**/*.{js,jsx,ts,tsx,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: `module`,
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.node,
      },
    },
    settings: {
      react: {
        version: `detect`,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...prettierConfig.rules,
      "prettier/prettier": `error`,
      "react/react-in-jsx-scope": `off`,
      "react/jsx-uses-react": `off`,
      "no-undef": `off`,
      "@typescript-eslint/no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        `error`,
        {
          argsIgnorePattern: `^_`,
          varsIgnorePattern: `^_`,
          destructuredArrayIgnorePattern: `^_`,
          caughtErrorsIgnorePattern: `^_`,
        },
      ],
    },
  },
]
