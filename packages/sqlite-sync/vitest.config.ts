import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'sqlite-sync',
    dir: './test',
    watch: true,
    typecheck: { enabled: true },
    testTimeout: 30000,
    hookTimeout: 30000,
    restoreMocks: true,
    testTransformMode: {
      ssr: ['**/*'],
    },
  },
})
