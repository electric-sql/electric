import type { Options } from 'tsdown'

const config: Options = {
  entry: [
    `src/index.ts`,
    `src/react.ts`,
    `src/tools.ts`,
    `src/sandbox.ts`,
    `src/sandbox-docker.ts`,
    `src/client.ts`,
    // First-class entry so its .d.ts is stable (raced chunk fails dts gen in CI).
    `src/skills/types.ts`,
  ],
  format: [`esm`, `cjs`],
  external: [/^@tanstack\//, /^@durable-streams\//],
  dts: true,
  clean: true,
}

export default config
