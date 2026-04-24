import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { McpClientPool } from '../pool.js'
import type { McpDiscoveredTool, McpServerConfig } from '../types.js'
import { MCP_DEFAULTS } from '../types.js'

export function bridgeMcpTools(
  serverName: string,
  tools: McpDiscoveredTool[],
  pool: McpClientPool,
  config: McpServerConfig
): AgentTool[] {
  return tools.map((mcpTool) =>
    bridgeSingleTool(serverName, mcpTool, pool, config)
  )
}

function bridgeSingleTool(
  serverName: string,
  mcpTool: McpDiscoveredTool,
  pool: McpClientPool,
  config: McpServerConfig
): AgentTool {
  const maxOutput = config.maxOutputChars ?? MCP_DEFAULTS.maxOutputChars

  return {
    name: `mcp__${serverName}__${mcpTool.name}`,
    label: mcpTool.name,
    description: mcpTool.description ?? ``,
    parameters: mcpTool.inputSchema as unknown as AgentTool[`parameters`],
    execute: async (_toolCallId, params) => {
      const client = await pool.acquire(serverName)
      try {
        const result = await client.callTool(
          mcpTool.name,
          params as Record<string, unknown>
        )
        const output = formatMcpResult(result)
        return truncateOutput(output, maxOutput)
      } finally {
        pool.release(serverName)
      }
    },
  }
}

interface TextBlock {
  type: `text`
  text: string
}

interface ToolOutput {
  content: TextBlock[]
  details: Record<string, unknown>
}

function formatMcpResult(result: {
  content: Array<{
    type: string
    text?: string
    data?: string
    mimeType?: string
  }>
  isError?: boolean
}): ToolOutput {
  const content: TextBlock[] = result.content.map((block) => {
    if (block.type === `text` && block.text !== undefined) {
      return { type: `text` as const, text: block.text }
    }
    if (block.type === `image`) {
      return {
        type: `text` as const,
        text: `[Image: ${block.mimeType ?? `unknown`}]`,
      }
    }
    return { type: `text` as const, text: JSON.stringify(block) }
  })

  return {
    content:
      content.length > 0
        ? content
        : [{ type: `text` as const, text: `(no output)` }],
    details: { isError: result.isError ?? false },
  }
}

export function truncateOutput(
  output: ToolOutput,
  maxChars: number
): ToolOutput {
  let totalChars = 0
  for (const block of output.content) {
    totalChars += block.text.length
  }

  if (totalChars <= maxChars) return output

  const truncated: TextBlock[] = output.content.map((block) => {
    if (block.text.length > maxChars) {
      return {
        type: `text` as const,
        text:
          block.text.slice(0, maxChars) +
          `\n\n[Output truncated at ${maxChars} chars. Original size: ${block.text.length} chars]`,
      }
    }
    return block
  })

  return { content: truncated, details: { ...output.details, truncated: true } }
}
