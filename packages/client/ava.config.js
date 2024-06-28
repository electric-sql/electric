/* eslint-env node */
import config from '../../common/ava.config.mjs'

// Developers can provide a `TEST_ONLY_DIALECT` value of `postgres`, `pglite`, or `sqlite`
// to run the unit tests only for that dialect.
// Developers can also provide a `DISABLE_DIALECT` value of `postgres`, `pglite`, or `sqlite`
// to disable the unit tests for that dialect but run all others.
const testOnlyDialect = process.env.TEST_ONLY_DIALECT
const disableDialect = process.env.DISABLE_DIALECT

if (testOnlyDialect && disableDialect) {
  throw new Error(
    'Cannot set both TEST_ONLY_DIALECT and DISABLE_DIALECT environment variables.'
  )
}

const files = ['test/**/*.test.ts', 'test/**/*.test.tsx']
const ignorePostgres = ['!test/**/postgres/**']
const ignorePglite = ['!test/**/pglite/**']
const ignoreSqlite = ['!test/**/sqlite/**']

switch (testOnlyDialect) {
  case 'postgres':
    files.push(...ignorePglite, ...ignoreSqlite)
    break
  case 'pglite':
    files.push(...ignorePostgres, ...ignoreSqlite)
    break
  case 'sqlite':
    files.push(...ignorePostgres, ...ignorePglite)
    break
}

switch (disableDialect) {
  case 'postgres':
    files.push(...ignorePostgres)
    break
  case 'pglite':
    files.push(...ignorePglite)
    break
  case 'sqlite':
    files.push(...ignoreSqlite)
    break
}

export default {
  ...config,
  files,
}
