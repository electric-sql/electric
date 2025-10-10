import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: `test/support/global-setup.ts`,
    setupFiles: ['vitest-localstorage-mock'],
    typecheck: { enabled: true },
    fileParallelism: false,
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['**/src/**'],
    },
    reporters: ['default', 'junit'],
    outputFile: './junit/test-report.junit.xml',
    environment: 'jsdom',
  },
})
