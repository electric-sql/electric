/**
 * Adapter: convert agents-mcp `BridgedTool` instances into pi-agent-core
 * `AgentTool` instances so they can be added to a Horton/Worker tool array.
 *
 * `BridgedTool` shape (from `@electric-ax/agents-mcp`):
 *   { name, description?, inputSchema?, run(args) -> Promise<unknown> }
 *
 * `AgentTool` shape (from `@mariozechner/pi-agent-core`):
 *   { name, label, description, parameters: TSchema, execute(toolCallId, params, signal?, onUpdate?) -> Promise<AgentToolResult<T>>, ... }
 *
 * MCP tool input schemas are JSON Schema objects, which are structurally
 * compatible with typebox `TSchema`. We cast them through and let the model
 * provider handle them. If `inputSchema` is missing, we fall back to an
 * open object schema.
 */
import { Type, type TSchema } from '@sinclair/typebox'
import type { BridgedTool } from '@electric-ax/agents-mcp'
import type { AgentTool } from '@mariozechner/pi-agent-core'

/** Default tool label when an MCP tool has no description. */
function defaultLabel(name: string): string {
  return name
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(` `)
}

function asParametersSchema(inputSchema: unknown): TSchema {
  if (
    inputSchema &&
    typeof inputSchema === `object` &&
    !Array.isArray(inputSchema)
  ) {
    // MCP tool inputSchema is JSON Schema; structurally compatible with TSchema.
    return inputSchema as TSchema
  }
  return Type.Object({}, { additionalProperties: true })
}

function stringifyResult(result: unknown): string {
  if (typeof result === `string`) return result
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

/** Convert a single BridgedTool into an AgentTool. */
export function bridgedToolToAgentTool(bridged: BridgedTool): AgentTool {
  return {
    name: bridged.name,
    label: defaultLabel(bridged.name),
    description: bridged.description ?? `MCP tool: ${bridged.name}`,
    parameters: asParametersSchema(bridged.inputSchema),
    execute: async (_toolCallId, params) => {
      const result = await bridged.run(params)
      return {
        content: [{ type: `text` as const, text: stringifyResult(result) }],
        details: result,
      }
    },
  }
}

/** Convert an array of BridgedTools into AgentTools. */
export function bridgedToolsToAgentTools(
  bridged: ReadonlyArray<BridgedTool>
): Array<AgentTool> {
  return bridged.map(bridgedToolToAgentTool)
}
