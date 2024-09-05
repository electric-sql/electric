import type { Options } from 'tsup'
import { defineConfig } from 'tsup'

export default defineConfig((options) => {
  const entry = {
    index: 'src/index.ts',
    persist: 'src/persist.ts',
  }
  const commonOptions: Partial<Options> = {
    entry,
    tsconfig: `./tsconfig.build.json`,
    sourcemap: true,
    ...options,
  }

  return [
    // Standard ESM, embedded `process.env.NODE_ENV` checks
    {
      ...commonOptions,
      format: ['esm'],
      outExtension: () => ({ js: '.mjs' }), // Add dts: '.d.ts' when egoist/tsup#1053 lands
      dts: true,
      clean: true,
    },
    // Support Webpack 4 by pointing `"module"` to a file with a `.js` extension
    {
      ...commonOptions,
      format: ['esm'],
      target: 'es2017',
      dts: false,
      outExtension: () => ({ js: '.js' }),
      entry: Object.fromEntries(
        Object.entries(entry).map(([key, value]) => [
          `${key}.legacy-esm`,
          value,
        ])
      ),
    },
    // Browser-ready ESM, production + minified
    {
      ...commonOptions,

      entry: Object.fromEntries(
        Object.entries(entry).map(([key, value]) => [`${key}.browser`, value])
      ),

      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
      format: ['esm'],
      outExtension: () => ({ js: '.mjs' }),
      minify: true,
    },
    {
      ...commonOptions,
      format: 'cjs',
      outDir: './dist/cjs/',
      outExtension: () => ({ js: '.cjs' }),
    },
  ]
})
