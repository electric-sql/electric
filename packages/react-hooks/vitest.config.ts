import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: `test/support/global-setup.ts`,
    setupFiles: [`test/support/react-setup.ts`],
    environment: `jsdom`,
    typecheck: { enabled: true },
    coverage: {
      provider: `istanbul`,
      reporter: [`text`, `json`, `html`, `lcov`],
      include: [`**/src/**`],
    },
    reporters: [`default`, `junit`],
    outputFile: `./junit/test-report.junit.xml`,
  },
})
