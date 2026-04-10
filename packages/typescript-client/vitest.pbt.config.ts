import { defineConfig } from 'vitest/config'

// Dedicated config for the property-based ShapeStream soak test.
// Skips the real-Electric global-setup because model-based.test.ts
// uses an in-process mock fetch gate and never touches the network.
export default defineConfig({
  test: {
    include: [`test/model-based.test.ts`, `test/pbt-micro.test.ts`],
    setupFiles: [`vitest-localstorage-mock`],
    fileParallelism: false,
    testTimeout: 3_600_000,
    environment: `jsdom`,
    reporters: [`default`],
  },
})
