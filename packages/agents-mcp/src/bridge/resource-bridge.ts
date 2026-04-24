import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { McpClientPool } from '../pool.js'

export function createResourceTools(pool: McpClientPool): AgentTool[] {
  return [createListResourcesTool(pool), createReadResourceTool(pool)]
}

function createListResourcesTool(pool: McpClientPool): AgentTool {
  return {
    name: `mcp__list_resources`,
    label: `List MCP Resources`,
    description: `List all available resources from connected MCP servers. Returns resource URIs, names, and descriptions.`,
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
          const resources = await client.listResources()
          pool.release(name)

          if (resources.length === 0) continue

          lines.push(`## ${name}`)
          for (const r of resources) {
            lines.push(
              `- **${r.name}** (\`${r.uri}\`)${r.description ? `: ${r.description}` : ``}`
            )
          }
          lines.push(``)
        } catch {
          // Server unavailable
        }
      }

      const text =
        lines.length > 0 ? lines.join(`\n`) : `No resources available.`
      return { content: [{ type: `text`, text }], details: {} }
    },
  }
}

function createReadResourceTool(pool: McpClientPool): AgentTool {
  return {
    name: `mcp__read_resource`,
    label: `Read MCP Resource`,
    description: `Read a specific resource from a connected MCP server by server name and resource URI.`,
    parameters: {
      type: `object`,
      properties: {
        server: { type: `string`, description: `MCP server name` },
        uri: { type: `string`, description: `Resource URI` },
      },
      required: [`server`, `uri`],
    } as unknown as AgentTool[`parameters`],
    execute: async (_toolCallId, params) => {
      const { server, uri } = params as { server: string; uri: string }
      const client = await pool.acquire(server)
      try {
        const contents = await client.readResource(uri)
        const text = contents
          .map((c) => c.text ?? `[binary: ${c.mimeType ?? `unknown`}]`)
          .join(`\n`)
        return {
          content: [{ type: `text`, text: text || `(empty resource)` }],
          details: {},
        }
      } finally {
        pool.release(server)
      }
    },
  }
}
