import { defineConfig } from 'tsup'

export default defineConfig([
  // Main library entry
  {
    entry: [`src/index.ts`],
    format: [`esm`],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
  },
  // CLI entry with shebang
  {
    entry: [`src/cli/index.ts`],
    format: [`esm`],
    outDir: `dist/cli`,
    dts: false,
    splitting: false,
    sourcemap: true,
    banner: {
      js: `#!/usr/bin/env node`,
    },
  },
])
