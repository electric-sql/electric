import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    benchmark: {
      include: [`packages/server-rust/bench/**/*.bench.ts`],
    },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
