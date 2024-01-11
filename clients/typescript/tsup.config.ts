import { globSync } from 'glob'
import { defineConfig } from 'tsup'

const entries = globSync('src/**/*.{ts,tsx,js,jsx}', { posix: true })

export default defineConfig({
  entry: entries,
  format: ['esm'],
  bundle: false,
  splitting: false,
  sourcemap: true,
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.js',
    }
  },
  tsconfig: 'tsconfig.build.json',
})
