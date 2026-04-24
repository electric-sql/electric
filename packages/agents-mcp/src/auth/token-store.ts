import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CONFIG_DIR = `.electric-agents`
const AUTH_FILE = `mcp-auth.json`

export interface StoredTokens {
  access_token: string
  refresh_token?: string
  expires_at?: number
  token_type: `Bearer`
}

interface AuthData {
  tokens?: Record<string, StoredTokens>
  verifiers?: Record<string, string>
  clients?: Record<string, Record<string, unknown>>
}

export class TokenStore {
  private readonly authPath: string
  private readonly configDir: string

  constructor(workingDirectory: string) {
    this.configDir = join(workingDirectory, CONFIG_DIR)
    this.authPath = join(this.configDir, AUTH_FILE)
  }

  getTokens(serverName: string): StoredTokens | undefined {
    return this.readAll().tokens?.[serverName]
  }

  saveTokens(serverName: string, tokens: StoredTokens): void {
    const data = this.readAll()
    data.tokens ??= {}
    data.tokens[serverName] = tokens
    this.writeAll(data)
  }

  removeTokens(serverName: string): void {
    const data = this.readAll()
    if (data.tokens) {
      delete data.tokens[serverName]
      this.writeAll(data)
    }
  }

  getCodeVerifier(serverName: string): string | undefined {
    return this.readAll().verifiers?.[serverName]
  }

  saveCodeVerifier(serverName: string, verifier: string): void {
    const data = this.readAll()
    data.verifiers ??= {}
    data.verifiers[serverName] = verifier
    this.writeAll(data)
  }

  getClientInfo(serverName: string): Record<string, unknown> | undefined {
    return this.readAll().clients?.[serverName]
  }

  saveClientInfo(serverName: string, info: Record<string, unknown>): void {
    const data = this.readAll()
    data.clients ??= {}
    data.clients[serverName] = info
    this.writeAll(data)
  }

  private readAll(): AuthData {
    if (!existsSync(this.authPath)) return {}
    return JSON.parse(readFileSync(this.authPath, `utf-8`)) as AuthData
  }

  private writeAll(data: AuthData): void {
    mkdirSync(this.configDir, { recursive: true })
    writeFileSync(this.authPath, JSON.stringify(data, null, 2) + `\n`, {
      mode: 0o600,
    })
  }
}
