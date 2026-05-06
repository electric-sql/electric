import { createRequire } from 'node:module'
import type { CredentialStore, OAuthClientInfo, OAuthTokens } from './types'

interface KeytarLike {
  setPassword(service: string, account: string, password: string): Promise<void>
  getPassword(service: string, account: string): Promise<string | null>
}

export interface OsKeychainOptions {
  service?: string /* default: 'electric-agents' */
  /** Override for tests. Default: lazy require('keytar'). */
  keytar?: KeytarLike
}

function tryLoadKeytar(): KeytarLike | undefined {
  try {
    // Lazy require via createRequire so the package builds without keytar's native deps
    // and works correctly in ESM context (package has "type": "module").
    const _require = createRequire(import.meta.url)
    return _require(`keytar`) as KeytarLike
  } catch {
    return undefined
  }
}

const TOKENS_PREFIX = `tokens`
const CLIENT_PREFIX = `client`

export function osKeychainCredentialStore(
  opts: OsKeychainOptions = {}
): CredentialStore {
  const service = opts.service ?? `electric-agents`
  // When keytar is explicitly passed as undefined (e.g. in tests simulating missing keytar),
  // treat as unavailable. When omitted, try to load lazily.
  const keytar = `keytar` in opts ? opts.keytar : tryLoadKeytar()
  if (!keytar) {
    console.warn(
      `[agents-mcp] os-keychain unavailable (keytar not installed); skipping`
    )
    return {}
  }
  return {
    async getOAuthTokens(server) {
      const raw = await keytar.getPassword(
        service,
        `${TOKENS_PREFIX}:${server}`
      )
      return raw ? (JSON.parse(raw) as OAuthTokens) : undefined
    },
    async saveOAuthTokens(server, tokens) {
      await keytar.setPassword(
        service,
        `${TOKENS_PREFIX}:${server}`,
        JSON.stringify(tokens)
      )
    },
    async getOAuthClientInfo(server) {
      const raw = await keytar.getPassword(
        service,
        `${CLIENT_PREFIX}:${server}`
      )
      return raw ? (JSON.parse(raw) as OAuthClientInfo) : undefined
    },
    async saveOAuthClientInfo(server, info) {
      await keytar.setPassword(
        service,
        `${CLIENT_PREFIX}:${server}`,
        JSON.stringify(info)
      )
    },
  }
}
