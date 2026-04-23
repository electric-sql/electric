import type { Options } from 'tsdown'

const config: Options = {
  entry: [
    `src/index.ts`,
    `src/completions.ts`,
    `src/observe-ui.tsx`,
    `src/entity-stream-db.ts`,
  ],
  format: [`esm`, `cjs`],
  platform: `node`,
  dts: true,
  clean: true,
  external: [/^@durable-streams\//, /^@electric-ax\//, /^omelette$/],
}

export default config
