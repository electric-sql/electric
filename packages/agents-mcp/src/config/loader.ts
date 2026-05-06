import { readFile } from 'node:fs/promises'
import type { McpServerConfig, McpAuthMode } from '../types'

export interface McpConfig {
  servers: Record<string, McpServerConfig>
}

const ALLOWED_MODES: McpAuthMode[] = [
  `apiKey`,
  `clientCredentials`,
  `authorizationCode`,
]

export function parseConfig(text: string): McpConfig {
  const data: unknown = JSON.parse(text)
  if (typeof data !== `object` || data === null || !(`servers` in data)) {
    throw new Error(`mcp.json must be an object with a "servers" key`)
  }
  const servers = (data as { servers: Record<string, unknown> }).servers
  for (const [name, raw] of Object.entries(servers)) {
    validateServer(name, raw)
  }
  return data as McpConfig
}

function validateServer(name: string, raw: unknown): void {
  if (typeof raw !== `object` || raw === null) {
    throw new Error(`Server "${name}" must be an object`)
  }
  const s = raw as Record<string, unknown>
  if (s.transport !== `stdio` && s.transport !== `http`) {
    throw new Error(`Server "${name}": transport must be "stdio" or "http"`)
  }
  if (s.transport === `stdio`) {
    if (typeof s.command !== `string`) {
      throw new Error(`Server "${name}" (stdio): command required`)
    }
  } else {
    if (typeof s.url !== `string`) {
      throw new Error(`Server "${name}" (http): url required`)
    }
    const auth = s.auth as Record<string, unknown> | undefined
    if (!auth) throw new Error(`Server "${name}" (http): auth required`)
    if (!ALLOWED_MODES.includes(auth.mode as McpAuthMode)) {
      throw new Error(
        `Server "${name}": auth.mode must be one of ${ALLOWED_MODES.join(`, `)}`
      )
    }
  }
}

export async function loadConfig(path: string): Promise<McpConfig> {
  const text = await readFile(path, `utf8`)
  return parseConfig(text)
}
