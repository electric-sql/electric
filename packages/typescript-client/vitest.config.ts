import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: `test/support/global-setup.ts`,
    setupFiles: [`vitest-localstorage-mock`, `./test/support/setup.ts`],
    typecheck: { enabled: true },
    fileParallelism: false,
    testTimeout: 30000, // 30s default timeout to catch hanging tests
    coverage: {
      provider: `istanbul`,
      reporter: [`text`, `json`, `html`, `lcov`],
      include: [`**/src/**`],
    },
    reporters: [`default`, `junit`],
    outputFile: `./junit/test-report.junit.xml`,
    environment: `jsdom`,
  },
})
