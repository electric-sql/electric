import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // No globalSetup - don't need Electric server for unit tests
    setupFiles: [`vitest-localstorage-mock`],
    include: [
      `test/up-to-date-tracker.test.ts`,
      `test/helpers.test.ts`,
      `test/parser.test.ts`,
      `test/snapshot-tracker.test.ts`,
      `test/expired-shapes-cache.test.ts`,
      `test/wake-detection.test.ts`,
      `test/shape-stream-state.test.ts`,
      `test/pause-lock.test.ts`,
      `test/stream.test.ts`,
      `test/204-no-content.test.ts`,
    ],
    testTimeout: 30000,
    environment: `jsdom`,
  },
})
