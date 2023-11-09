const [major, minor, patch] = process.versions.node.split('.').map(Number)

let loaderArg = '--loader=tsx'
if (major > 20 || (major === 20 && minor > 6)) {
  loaderArg = '--import=tsx'
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
