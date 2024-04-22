const [major, minor, _patch] = process.versions.node.split('.').map(Number)
const testDialect = process.env.DIALECT

let loaderArg
if (
  major > 20 ||
  (major === 20 && minor >= 6) ||
  (major === 18 && minor >= 19)
) {
  loaderArg = '--import=tsx'
} else {
  loaderArg = '--loader=tsx'
}

const files = ['test/**/*.test.ts', 'test/**/*.test.tsx']
const ignorePostgres = ['!test/**/postgres/**']
const ignorePglite = ['!test/**/pglite/**']
const ignoreSqlite = ['!test/**/sqlite/**']

if (testDialect === 'postgres') {
  files.push(...ignorePglite, ...ignoreSqlite)
}

if (testDialect === 'pglite') {
  files.push(...ignorePostgres, ...ignoreSqlite)
}

if (testDialect === 'sqlite') {
  files.push(...ignorePostgres, ...ignorePglite)
}

export default {
  timeout: '10m',
  files,
  extensions: {
    ts: 'module',
    tsx: 'module',
  },
  nodeArguments: ['--no-warnings', loaderArg],
  workerThreads: false,
}
