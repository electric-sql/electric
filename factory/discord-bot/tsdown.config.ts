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
    entry: [`src/adapter/host-node.ts`, `src/adapter/register-commands.ts`],
    format: [`esm`],
    platform: `node`,
    dts: false,
    clean: false,
  },
])
