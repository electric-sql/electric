import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Default to ESM to avoid CJS deprecation warning
  define: {
    'import.meta.vitest': 'undefined'
  },
  test: {
    globals: true,
    environment: 'node', 
    include: ['**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**']
    }
  }
})
