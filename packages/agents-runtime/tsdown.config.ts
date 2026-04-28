import type { Options } from 'tsdown'

const config: Options = {
  entry: [`src/index.ts`, `src/react.ts`, `src/tools.ts`],
  format: [`esm`, `cjs`],
  dts: true,
  clean: true,
}

export default config
