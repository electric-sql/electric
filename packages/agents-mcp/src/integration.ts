import type { AgentTool } from '@mariozechner/pi-agent-core'
import { ConfigStore } from './config/config-store.js'
import { McpClientPool } from './pool.js'
import { createConfigTools } from './config/config-tools.js'
import type { McpIntegration, McpOverrides } from './types.js'

export function createMcpIntegration(opts: {
  workingDirectory: string
  onAuthUrl?: (serverName: string, url: string) => void
}): McpIntegration {
  const configStore = new ConfigStore(opts.workingDirectory)
  const config = configStore.load({ expandEnv: true })

  const pool = new McpClientPool(config, {
    workingDirectory: opts.workingDirectory,
    onAuthUrl: opts.onAuthUrl
      ? (url: string) => opts.onAuthUrl!(``, url)
      : undefined,
  })

  const configTools = createConfigTools(configStore, pool)

  return {
    configTools,

    async getTools(overrides?: McpOverrides): Promise<AgentTool[]> {
      return pool.getTools(overrides)
    },

    getServerInstructions(): Record<string, string> {
      return pool.getInstructions()
    },

    async getServerSummary(): Promise<string> {
      const states = pool.getServerStates()
      const connected = states.filter((s) => s.status === `connected`)
      if (connected.length === 0) return ``

      const sections = connected.map((s) => {
        const toolNames = s.tools
          .map((t) => `mcp__${s.name}__${t.name}`)
          .join(`, `)
        const header = `## ${s.name}`
        const instructions = s.instructions
          ? `Instructions: ${s.instructions}\n`
          : ``
        const tools = s.tools.length > 0 ? `Tools: ${toolNames}` : `No tools`
        return `${header}\n${instructions}${tools}`
      })

      return `# MCP Servers\nThe following external tool servers are connected:\n\n${sections.join(`\n\n`)}\n\nUse mcp__list_resources to discover available resources from these servers.`
    },

    async close(): Promise<void> {
      await pool.close()
    },
  }
}
