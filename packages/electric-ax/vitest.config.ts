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
    alias: [
      {
        find: `@electric-ax/agents/server-headers`,
        replacement: resolve(__dirname, `../agents/src/server-headers.ts`),
      },
      {
        find: `@electric-ax/agents`,
        replacement: resolve(__dirname, `../agents/src/index.ts`),
      },
    ],
  },
})
