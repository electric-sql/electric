module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:vue/vue3-recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'src/generated/*'],
  parser: "vue-eslint-parser",
  parserOptions: { 
    parser: "@typescript-eslint/parser" 
  }
}
