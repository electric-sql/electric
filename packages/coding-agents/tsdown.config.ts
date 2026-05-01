import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: [`./src/index.ts`],
    outDir: `dist`,
    format: [`esm`, `cjs`],
    dts: true,
    clean: true,
    sourcemap: true,
  },
  {
    entry: [`./src/cli/import-claude.ts`],
    outDir: `dist/cli`,
    format: [`esm`],
    dts: false,
    sourcemap: true,
  },
])
