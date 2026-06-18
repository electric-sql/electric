import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      // expo-linking transitively imports react-native which uses Flow
      // `import typeof` syntax that Rollup/Vite cannot parse. Alias it to a
      // minimal stub that implements only what the unit tests need.
      'expo-linking': path.resolve(
        __dirname,
        `src/test-utils/expo-linking-stub.ts`
      ),
      // Resolve the shared link-format module to source so unit tests don't
      // depend on agents-runtime being built first (mirrors the metro alias).
      '@electric-ax/agents-runtime/session-links': path.resolve(
        __dirname,
        `../agents-runtime/src/session-links.ts`
      ),
    },
  },
})
