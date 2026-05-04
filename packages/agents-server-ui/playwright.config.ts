import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: `./test/e2e`,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: `list`,
  use: {
    baseURL: `http://localhost:4437/__agent_ui/`,
    trace: `on-first-retry`,
    screenshot: `only-on-failure`,
  },
  projects: [{ name: `chromium`, use: { ...devices[`Desktop Chrome`] } }],
})
