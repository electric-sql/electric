import fs from 'node:fs/promises'
import { expandEnv } from './env-expand'
import type { McpServerConfig } from '../types'

export interface McpConfig {
  servers: McpServerConfig[]
  raw: unknown
}

const KNOWN_AUTH_MODES = new Set([
  `none`,
  `apiKey`,
  `clientCredentials`,
  `authorizationCode`,
])
const FORBIDDEN_REF_KEYS = [`valueRef`, `clientIdRef`, `clientSecretRef`]

function fail(msg: string): never {
  throw new Error(`mcp.json: ${msg}`)
}

export function parseConfig(
  raw: unknown,
  env: NodeJS.ProcessEnv = process.env
): McpConfig {
  if (!raw || typeof raw !== `object`) fail(`not an object`)
  const top = Object.keys(raw as object)
  for (const k of top)
    if (k !== `servers`) fail(`unknown top-level field "${k}"`)
  const serversObj = (raw as Record<string, unknown>).servers
  if (!serversObj || typeof serversObj !== `object`)
    fail(`missing "servers" object`)

  const servers: McpServerConfig[] = []
  for (const [name, entry] of Object.entries(
    serversObj as Record<string, unknown>
  )) {
    if (!entry || typeof entry !== `object`)
      fail(`server "${name}" not an object`)
    const e = entry as Record<string, unknown>
    if (e.transport !== `http` && e.transport !== `stdio`)
      fail(`server "${name}" transport must be 'http' or 'stdio'`)
    const auth = (e.auth ?? { mode: `none` }) as Record<string, unknown>
    if (typeof auth.mode !== `string` || !KNOWN_AUTH_MODES.has(auth.mode))
      fail(`server "${name}" auth.mode invalid`)
    for (const k of FORBIDDEN_REF_KEYS) {
      if (k in auth)
        fail(
          `server "${name}" uses forbidden "${k}" — secrets are not configured in mcp.json (use the CredentialStore at bootstrap)`
        )
    }

    if (e.transport === `http`) {
      if (typeof e.url !== `string`) fail(`server "${name}" missing url`)
      servers.push({
        name,
        transport: `http`,
        url: expandEnv(e.url, env),
        auth: expandEnv.deep(auth, env) as McpServerConfig[`auth`],
        timeoutMs: typeof e.timeoutMs === `number` ? e.timeoutMs : undefined,
      })
    } else {
      if (typeof e.command !== `string`)
        fail(`server "${name}" missing command`)
      const args = Array.isArray(e.args)
        ? (e.args as unknown[]).map((a) => expandEnv(String(a), env))
        : []
      servers.push({
        name,
        transport: `stdio`,
        command: expandEnv(e.command, env),
        args,
        env:
          e.env && typeof e.env === `object`
            ? Object.fromEntries(
                Object.entries(e.env as Record<string, unknown>).map(
                  ([k, v]) => [k, expandEnv(String(v), env)]
                )
              )
            : undefined,
        auth: expandEnv.deep(auth, env) as McpServerConfig[`auth`],
        timeoutMs: typeof e.timeoutMs === `number` ? e.timeoutMs : undefined,
      })
    }
  }
  return { servers, raw }
}

export async function loadConfig(
  path: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<McpConfig> {
  const text = await fs.readFile(path, `utf-8`)
  return parseConfig(JSON.parse(text), env)
}
