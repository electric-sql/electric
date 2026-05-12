import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: `node`,
    testTimeout: 15_000,
    reporters: [`default`, `junit`],
    outputFile: `./junit/test-report.junit.xml`,
  },
})
