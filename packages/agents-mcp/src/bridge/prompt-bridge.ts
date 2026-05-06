import { prefixToolName } from './tool-bridge'
import { withTimeout, DEFAULT_TIMEOUT_MS } from '../transports/timeout'
import type { BridgedTool } from './tool-bridge'

export interface BuildPromptToolsOpts {
  server: string
  client: {
    listPrompts: () => Promise<unknown>
    getPrompt: (args: {
      name: string
      arguments?: Record<string, unknown>
    }) => Promise<unknown>
  }
  timeoutMs?: number
}

export function buildPromptTools(opts: BuildPromptToolsOpts): BridgedTool[] {
  const ms = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return [
    {
      name: prefixToolName(opts.server, `list_prompts`),
      server: opts.server,
      description: `List prompts on ${opts.server}`,
      inputSchema: { type: `object`, properties: {} },
      call: () => withTimeout(opts.client.listPrompts(), ms),
    },
    {
      name: prefixToolName(opts.server, `get_prompt`),
      server: opts.server,
      description: `Get a prompt template from ${opts.server}`,
      inputSchema: {
        type: `object`,
        properties: {
          name: { type: `string` },
          arguments: { type: `object`, additionalProperties: true },
        },
        required: [`name`],
      },
      call: (args) =>
        withTimeout(
          opts.client.getPrompt(
            args as { name: string; arguments?: Record<string, unknown> }
          ),
          ms
        ),
    },
  ]
}
