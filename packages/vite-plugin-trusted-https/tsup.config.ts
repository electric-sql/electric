import type { Options } from 'tsup'
import { defineConfig } from 'tsup'

export default defineConfig((options) => {
  const commonOptions: Partial<Options> = {
    entry: {
      index: 'src/index.ts',
      cli: 'src/cli.ts',
    },
    tsconfig: `./tsconfig.build.json`,
    sourcemap: true,
    ...options,
  }

  return [
    // ESM build with .d.ts
    {
      ...commonOptions,
      format: ['esm'],
      outExtension: () => ({ js: '.mjs' }),
      dts: {
        entry: commonOptions.entry,
        resolve: true,
      },
      clean: true,
    },
    // CJS build with .d.cts
    {
      ...commonOptions,
      format: ['cjs'],
      outDir: './dist/cjs/',
      outExtension: () => ({ js: '.cjs' }),
      dts: {
        entry: commonOptions.entry,
        resolve: true,
      },
      clean: false,
    },
    // Support Webpack 4 by pointing "module" to a file with a .js extension
    {
      ...commonOptions,
      format: ['esm'],
      target: 'es2017',
      dts: false,
      outExtension: () => ({ js: '.js' }),
      entry: { 'index.legacy-esm': 'src/index.ts' },
    },
  ]
})