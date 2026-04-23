import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    fileParallelism: false,
    maxWorkers: 1,
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
      '@electric-ax/agent-runtime': resolve(__dirname, `./src/index.ts`),
      '@electric-ax/agent-runtime/react': resolve(__dirname, `./src/react.ts`),
    },
  },
})
