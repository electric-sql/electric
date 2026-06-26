import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: [`packages/server-rust/conformance/**/*.test.ts`],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
