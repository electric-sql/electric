const [major, minor, _patch] = process.versions.node.split('.').map(Number)

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

export default {
  timeout: '10m',
  files: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  extensions: {
    ts: 'module',
    tsx: 'module',
  },
  nodeArguments: ['--no-warnings', loaderArg],
  workerThreads: false,
}
