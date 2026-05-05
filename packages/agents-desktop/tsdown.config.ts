import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: [`src/main.ts`],
    format: [`esm`],
    platform: `node`,
    external: [`electron`],
    dts: false,
    clean: true,
  },
  {
    entry: { preload: `src/preload.ts` },
    format: [`cjs`],
    platform: `node`,
    external: [`electron`],
    outExtensions: () => ({ js: `.cjs` }),
    dts: false,
    clean: false,
  },
])
