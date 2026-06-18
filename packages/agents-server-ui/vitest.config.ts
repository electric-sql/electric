import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the shared link-format module to source so unit tests don't
      // depend on agents-runtime being built first (mirrors vite.config.ts).
      '@electric-ax/agents-runtime/session-links': resolve(
        __dirname,
        `../agents-runtime/src/session-links.ts`
      ),
    },
  },
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
