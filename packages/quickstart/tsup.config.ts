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
    // ESM build
    {
      ...commonOptions,
      format: ['esm'],
      outExtension: () => ({ js: '.js' }),
      clean: true,
    },
  ]
})