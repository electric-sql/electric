import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    passWithNoTests: true,
    coverage: {
      provider: `v8`,
      reporter: [`text`, `json`, `html`, `lcov`],
      include: [`src/**/*.{ts,tsx}`],
    },
    reporters: [`default`, `junit`],
    outputFile: `./junit/test-report.junit.xml`,
  },
})
