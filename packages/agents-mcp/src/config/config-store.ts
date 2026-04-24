import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expandConfigValues } from './env-expand'
import type { McpConfig, McpServerConfig } from '../types'

const CONFIG_DIR = `.electric-agents`
const CONFIG_FILE = `mcp.json`
const GITIGNORE_FILE = `.gitignore`
const GITIGNORE_CONTENT = `mcp-auth.json\n`

const EMPTY_CONFIG: McpConfig = { servers: {} }

export class ConfigStore {
  private readonly configDir: string
  private readonly configPath: string

  constructor(private readonly workingDirectory: string) {
    this.configDir = join(workingDirectory, CONFIG_DIR)
    this.configPath = join(this.configDir, CONFIG_FILE)
  }

  load(opts?: { expandEnv?: boolean }): McpConfig {
    if (!existsSync(this.configPath)) return { ...EMPTY_CONFIG }

    const raw = readFileSync(this.configPath, `utf-8`)
    const parsed = JSON.parse(raw) as McpConfig

    if (!parsed.servers) return { ...EMPTY_CONFIG }

    if (opts?.expandEnv) {
      return expandConfigValues(parsed, process.env as Record<string, string>)
    }
    return parsed
  }

  save(config: McpConfig): void {
    mkdirSync(this.configDir, { recursive: true })
    writeFileSync(this.configPath, JSON.stringify(config, null, 2) + `\n`)
    this.ensureGitignore()
  }

  addServer(name: string, serverConfig: McpServerConfig): void {
    const config = this.load()
    config.servers[name] = serverConfig
    this.save(config)
  }

  removeServer(name: string): boolean {
    const config = this.load()
    if (!(name in config.servers)) return false
    delete config.servers[name]
    this.save(config)
    return true
  }

  private ensureGitignore(): void {
    const gitignorePath = join(this.configDir, GITIGNORE_FILE)
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, `utf-8`)
      if (!content.includes(`mcp-auth.json`)) {
        writeFileSync(gitignorePath, content + GITIGNORE_CONTENT)
      }
      return
    }
    writeFileSync(gitignorePath, GITIGNORE_CONTENT)
  }
}
