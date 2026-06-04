import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The smoke test boots a real server subprocess, so give hooks headroom.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
