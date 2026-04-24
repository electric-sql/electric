import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConfigStore } from './config-store.js'
import type { McpClientPool } from '../pool.js'
import type { McpServerConfig } from '../types.js'

export function createConfigTools(
  configStore: ConfigStore,
  pool: McpClientPool
): AgentTool[] {
  return [
    createAddServerTool(configStore, pool),
    createRemoveServerTool(configStore, pool),
    createListServersTool(pool),
    createListToolsTool(pool),
  ]
}

function createAddServerTool(
  configStore: ConfigStore,
  pool: McpClientPool
): AgentTool {
  return {
    name: `mcp__manage__add_server`,
    label: `Add MCP Server`,
    description: `Add a new MCP server to the configuration and attempt to connect to it.`,
    parameters: {
      type: `object`,
      properties: {
        name: {
          type: `string`,
          description: `Unique name for the server`,
        },
        command: {
          type: `string`,
          description: `Command to run (for stdio transport)`,
        },
        args: {
          type: `array`,
          items: { type: `string` },
          description: `Arguments for the command`,
        },
        url: {
          type: `string`,
          description: `URL for streamable HTTP transport`,
        },
        env: {
          type: `object`,
          additionalProperties: { type: `string` },
          description: `Environment variables for the server process`,
        },
      },
      required: [`name`],
    } as unknown as AgentTool[`parameters`],
    execute: async (_toolCallId, params) => {
      const { name, ...rest } = params as { name: string } & McpServerConfig

      const serverConfig: McpServerConfig = rest

      configStore.addServer(name, serverConfig)
      pool.addServer(name, serverConfig)

      let connectionNote = ``
      try {
        await pool.acquire(name)
        pool.release(name)
        connectionNote = ` and connected successfully`
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        connectionNote = ` (connection failed: ${msg})`
      }

      const text = `Added server "${name}"${connectionNote}.`
      return { content: [{ type: `text`, text }], details: {} }
    },
  }
}

function createRemoveServerTool(
  configStore: ConfigStore,
  pool: McpClientPool
): AgentTool {
  return {
    name: `mcp__manage__remove_server`,
    label: `Remove MCP Server`,
    description: `Remove an MCP server from the configuration and disconnect it.`,
    parameters: {
      type: `object`,
      properties: {
        name: {
          type: `string`,
          description: `Name of the server to remove`,
        },
      },
      required: [`name`],
    } as unknown as AgentTool[`parameters`],
    execute: async (_toolCallId, params) => {
      const { name } = params as { name: string }

      await pool.removeServer(name)
      configStore.removeServer(name)

      const text = `Removed server "${name}".`
      return { content: [{ type: `text`, text }], details: {} }
    },
  }
}

function createListServersTool(pool: McpClientPool): AgentTool {
  return {
    name: `mcp__manage__list_servers`,
    label: `List MCP Servers`,
    description: `List all configured MCP servers with their current connection status and available tools.`,
    parameters: {
      type: `object`,
      properties: {},
    } as unknown as AgentTool[`parameters`],
    execute: async (_toolCallId, _params) => {
      const states = pool.getServerStates()

      if (states.length === 0) {
        return {
          content: [{ type: `text`, text: `No MCP servers configured.` }],
          details: {},
        }
      }

      const lines: string[] = []
      for (const state of states) {
        lines.push(`## ${state.name}`)
        lines.push(`Status: ${state.status}`)
        if (state.error) {
          lines.push(`Error: ${state.error}`)
        }
        if (state.tools.length > 0) {
          lines.push(`Tools: ${state.tools.map((t) => t.name).join(`, `)}`)
        } else {
          lines.push(`Tools: none`)
        }
        if (state.instructions) {
          lines.push(`Instructions: ${state.instructions}`)
        }
        lines.push(``)
      }

      const text = lines.join(`\n`).trim()
      return { content: [{ type: `text`, text }], details: {} }
    },
  }
}

function createListToolsTool(pool: McpClientPool): AgentTool {
  return {
    name: `mcp__manage__list_tools`,
    label: `List MCP Tools`,
    description: `List all tools available from connected MCP servers.`,
    parameters: {
      type: `object`,
      properties: {
        server: {
          type: `string`,
          description: `Filter by server name (optional)`,
        },
      },
    } as unknown as AgentTool[`parameters`],
    execute: async (_toolCallId, params) => {
      const filter = (params as { server?: string }).server
      const servers = pool.getEnabledServers()
      const lines: string[] = []

      for (const { name } of servers) {
        if (filter && name !== filter) continue
        try {
          const client = await pool.acquire(name)
          const tools = client.tools
          pool.release(name)

          if (tools.length === 0) continue

          lines.push(`## ${name}`)
          for (const tool of tools) {
            const desc = tool.description ? `: ${tool.description}` : ``
            lines.push(`- **${tool.name}**${desc}`)
          }
          lines.push(``)
        } catch {
          // Server unavailable, skip
        }
      }

      const text =
        lines.length > 0 ? lines.join(`\n`).trim() : `No tools available.`
      return { content: [{ type: `text`, text }], details: {} }
    },
  }
}
