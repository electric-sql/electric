import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: `node`,
    testTimeout: 120_000, // integration tests build images, can be slow
  },
})
