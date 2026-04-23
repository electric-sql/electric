import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: [`src/index.ts`],
    format: [`esm`, `cjs`],
    platform: `node`,
    dts: true,
    clean: true,
  },
  {
    entry: [`src/entrypoint.ts`],
    format: [`esm`],
    platform: `node`,
    dts: false,
    clean: false,
  },
])
