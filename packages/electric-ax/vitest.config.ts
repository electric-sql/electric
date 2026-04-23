import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: `node`,
    coverage: {
      provider: `v8`,
      reporter: [`text`, `json`, `html`, `lcov`],
      include: [`src/**/*.{ts,tsx}`],
    },
    reporters: [`default`, `junit`],
    outputFile: `./junit/test-report.junit.xml`,
  },
  resolve: {
    alias: {
      '@electric-ax/builtin-agents': resolve(
        __dirname,
        `../builtin-agents/src/index.ts`
      ),
    },
  },
})
