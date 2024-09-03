import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: `test/support/global-setup.ts`,
    typecheck: { enabled: true },
  },
})
