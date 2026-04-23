import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: `node`,
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
