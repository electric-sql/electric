import { defineConfig } from 'vitest/config'
import { codecovVitePlugin } from '@codecov/vite-plugin'

export default defineConfig({
  // Default to ESM to avoid CJS deprecation warning
  define: {
    'import.meta.vitest': 'undefined',
  },
  plugins: [
    codecovVitePlugin({
      enableBundleAnalysis: process.env.CODECOV_TOKEN !== undefined,
      bundleName: '@electric-sql/y-electric',
      uploadToken: process.env.CODECOV_TOKEN,
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['**/src/**'],
    },
    reporters: ['default', 'junit'],
    outputFile: './junit/test-report.junit.xml',
  },
})
