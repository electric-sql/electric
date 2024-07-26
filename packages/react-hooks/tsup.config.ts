import type { Options } from 'tsup'
import { defineConfig } from 'tsup'

export default defineConfig(options => {
  const commonOptions: Partial<Options> = {
    entry: {
      index: 'src/index.ts'
    },
    tsconfig: `./tsconfig.build.json`,
    // esbuildPlugins: [mangleErrorsTransform],
    sourcemap: true,
    ...options
  }

  return [
    // Standard ESM, embedded `process.env.NODE_ENV` checks
    {
      ...commonOptions,
      format: ['esm'],
      outExtension: () => ({ js: '.mjs' }), // Add dts: '.d.ts' when egoist/tsup#1053 lands
      dts: true,
      clean: true
    },
    // Support Webpack 4 by pointing `"module"` to a file with a `.js` extension
    {
      ...commonOptions,
      format: ['esm'],
      target: 'es2017',
      dts: false,
      outExtension: () => ({ js: '.js' }),
      entry: { 'index.legacy-esm': 'src/index.ts' }
    },
    // Browser-ready ESM, production + minified
    {
      ...commonOptions,
      entry: {
        'index.browser': 'src/index.ts'
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify('production')
      },
      format: ['esm'],
      outExtension: () => ({ js: '.mjs' }),
      minify: true
    },
    {
      ...commonOptions,
      format: 'cjs',
      outDir: './dist/cjs/',
      outExtension: () => ({ js: '.cjs' })
    }
  ]
})
