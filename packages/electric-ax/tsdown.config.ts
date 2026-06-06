import type { Options } from 'tsdown'
import { readFileSync } from 'node:fs'

const packageVersion = readPackageVersion()
type VersionPlugin = {
  name: string
  transform: (code: string, id: string) => string | null
}

const config: Options = {
  entry: [
    `src/index.ts`,
    `src/completions.ts`,
    `src/start.ts`,
    `src/observe-ui.tsx`,
    `src/types-table.tsx`,
    `src/entity-stream-db.ts`,
    `src/init.ts`,
  ],
  format: [`esm`, `cjs`],
  platform: `node`,
  dts: true,
  clean: true,
  plugins: [packageVersionPlugin(packageVersion)],
  external: [/^@durable-streams\//, /^@electric-ax\//, /^omelette$/],
}

export default config

function readPackageVersion(): string {
  const raw = readFileSync(new URL(`./package.json`, import.meta.url), `utf8`)
  const parsed = JSON.parse(raw) as { version?: unknown }
  if (typeof parsed.version !== `string` || !parsed.version.trim()) {
    throw new Error(`packages/electric-ax/package.json is missing a version`)
  }
  return parsed.version.trim()
}

function packageVersionPlugin(version: string): VersionPlugin {
  return {
    name: `electric-ax-package-version`,
    transform(code: string, id: string) {
      if (!id.endsWith(`/src/version.ts`)) return null
      return code.replaceAll(`__ELECTRIC_AX_CLI_VERSION__`, version)
    },
  }
}
