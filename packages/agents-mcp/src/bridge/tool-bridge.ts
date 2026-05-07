import { withTimeout, DEFAULT_TIMEOUT_MS } from '../transports/timeout'
import type { McpToolError } from '../types'

const PREFIX = `mcp`
const MAX_LEN = 128

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, `_`)
}

export function prefixToolName(server: string, tool: string): string {
  const full = `${PREFIX}__${sanitize(server)}__${sanitize(tool)}`
  return full.length > MAX_LEN ? full.slice(0, MAX_LEN) : full
}

/**
 * Coerce an MCP tool's inputSchema into a shape downstream LLM adapters can
 * consume safely. Some servers send `{ type: 'object' }` with no `properties`
 * for no-arg tools; pi-agent-core walks `inputSchema.properties` and crashes on
 * undefined. We default `properties` to `{}` and `required` to `[]` for object
 * schemas; non-object schemas pass through unchanged.
 */
export function normalizeInputSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== `object`) {
    return { type: `object`, properties: {}, required: [] }
  }
  const s = schema as Record<string, unknown>
  if (s.type !== `object`) return schema
  if (s.properties && typeof s.properties === `object`) return schema
  return {
    ...s,
    properties: {},
    required: Array.isArray(s.required) ? s.required : [],
  }
}

/**
 * Build a BridgedTool from a synthetic (non-MCP-server-backed) call. Used by
 * the resource and prompt bridges. Caller supplies the JSON schema directly.
 */
export function makeSyntheticBridgedTool(opts: {
  name: string
  server: string
  label: string
  description?: string
  schema: unknown
  run: (args: unknown, signal?: AbortSignal) => Promise<unknown>
}): BridgedTool {
  return {
    name: opts.name,
    server: opts.server,
    description: opts.description,
    inputSchema: opts.schema,
    parameters: opts.schema,
    label: opts.label,
    async call(args: unknown) {
      return await opts.run(args)
    },
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
      const result = (await opts.run(params, signal)) as {
        content?: Array<{ type: string; text?: string }>
      }
      return {
        content: Array.isArray(result?.content) ? result.content : [],
        details: result,
      }
    },
  }
}

export interface BridgeToolOpts {
  server: string
  tool: { name: string; description?: string; inputSchema: unknown }
  /**
   * Subset of the MCP SDK Client used here.
   *
   * The real signature of Client.callTool in @modelcontextprotocol/sdk ≥ 1.10 is:
   *   callTool(params, resultSchema?, options?)
   * where the SECOND argument is a Zod schema (defaults to CallToolResultSchema) and
   * the THIRD argument is a RequestOptions bag that may include { signal, onProgress }.
   *
   * We model this correctly here so that invoke() never passes signal/onProgress as
   * the resultSchema (which would cause "v3Schema.safeParse is not a function").
   */
  client: {
    callTool: (
      args: { name: string; arguments?: unknown },
      resultSchema?: unknown,
      opts?: { onProgress?: (p: unknown) => void; signal?: AbortSignal }
    ) => Promise<unknown>
  }
  timeoutMs?: number
  /** Optional progress notification callback forwarded to the SDK. */
  onProgress?: (p: unknown) => void
  /** Optional AbortSignal forwarded to the SDK callTool. */
  signal?: AbortSignal
}

export interface BridgedTool {
  name: string
  server: string
  description?: string
  /** MCP wire shape — JSON schema. */
  inputSchema: unknown
  /** pi-ai/pi-agent expects `parameters` (same JSON schema, different field). */
  parameters: unknown
  /** Display label used by pi-agent UI bridges. */
  label: string
  /** Direct MCP-style call. */
  call(args: unknown): Promise<unknown>
  /** pi-agent execute signature. Wraps `call` and returns AgentToolResult-shaped output. */
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal
  ) => Promise<{
    content: Array<{ type: string; text?: string }>
    details: unknown
  }>
}

export function bridgeMcpTool(opts: BridgeToolOpts): BridgedTool {
  const name = prefixToolName(opts.server, opts.tool.name)
  const schema = normalizeInputSchema(opts.tool.inputSchema)
  const ms = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const invoke = async (
    args: unknown,
    extra?: { signal?: AbortSignal; onProgress?: (p: unknown) => void }
  ): Promise<unknown> => {
    const onProgress = extra?.onProgress ?? opts.onProgress
    const signal = extra?.signal ?? opts.signal
    // The real MCP SDK Client.callTool signature is:
    //   callTool(params, resultSchema?, options?)
    // The SECOND positional arg is a Zod schema (NOT an options bag).
    // Passing { onProgress, signal } there would corrupt resultSchema and cause
    // "v3Schema.safeParse is not a function" when the response is validated.
    // We omit resultSchema (letting it default to CallToolResultSchema) and
    // pass signal/onProgress only as the THIRD argument when needed.
    const callArgs: Parameters<typeof opts.client.callTool> =
      onProgress !== undefined || signal !== undefined
        ? [
            { name: opts.tool.name, arguments: args },
            undefined, // resultSchema — keep the SDK default (CallToolResultSchema)
            { onProgress, signal },
          ]
        : [{ name: opts.tool.name, arguments: args }]
    return await withTimeout(opts.client.callTool(...callArgs), ms)
  }

  return {
    name,
    server: opts.server,
    description: opts.tool.description,
    inputSchema: schema,
    parameters: schema,
    label: opts.tool.name,
    async call(args) {
      try {
        return await invoke(args)
      } catch (err) {
        const e = err as Partial<McpToolError> & { message?: string }
        if (e.kind === `timeout`) throw err
        const wrapped: McpToolError = {
          kind: `transport_error`,
          message: e.message ?? String(err),
        }
        throw wrapped
      }
    },
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
      const result = (await invoke(params, { signal })) as {
        content?: Array<{ type: string; text?: string }>
        isError?: boolean
      }
      return {
        content: Array.isArray(result?.content) ? result.content : [],
        details: result,
      }
    },
  }
}
