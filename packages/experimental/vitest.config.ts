import { defineConfig } from 'vitest/config'
import { codecovVitePlugin } from '@codecov/vite-plugin'

export default defineConfig({
  plugins: [
    codecovVitePlugin({
      enableBundleAnalysis: process.env.CODECOV_TOKEN !== undefined,
      bundleName: '@electric-sql/experimental',
      uploadToken: process.env.CODECOV_TOKEN,
    }),
  ],
  test: {
    globalSetup: `test/support/global-setup.ts`,
    typecheck: { enabled: true },
    fileParallelism: false,
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['**/src/**'],
    },
    reporters: ['default', 'junit'],
    outputFile: './junit/test-report.junit.xml',
  },
})
