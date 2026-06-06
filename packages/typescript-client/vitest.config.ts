import { defineConfig } from 'vitest/config'

const isCoverageRun =
  process.argv.includes(`--coverage`) ||
  process.env.npm_lifecycle_event === `coverage`
const isCI = process.env.CI === `true`

export default defineConfig({
  test: {
    globalSetup: `test/support/global-setup.ts`,
    setupFiles: [`vitest-localstorage-mock`],
    typecheck: { enabled: !isCoverageRun },
    fileParallelism: false,
    testTimeout: 30000, // 30s default timeout to catch hanging tests
    coverage: {
      provider: `v8`,
      reporter: isCI ? [`text`, `lcov`] : [`text`, `json`, `html`, `lcov`],
      include: [`**/src/**`],
    },
    reporters: [`default`, `junit`],
    outputFile: `./junit/test-report.junit.xml`,
    environment: `jsdom`,
  },
})
