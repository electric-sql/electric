import { prefixToolName, makeSyntheticBridgedTool } from './tool-bridge'
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
    makeSyntheticBridgedTool({
      name: prefixToolName(opts.server, `list_prompts`),
      server: opts.server,
      label: `list_prompts`,
      description: `List prompts on ${opts.server}`,
      schema: { type: `object`, properties: {}, required: [] },
      run: () => withTimeout(opts.client.listPrompts(), ms),
    }),
    makeSyntheticBridgedTool({
      name: prefixToolName(opts.server, `get_prompt`),
      server: opts.server,
      label: `get_prompt`,
      description: `Get a prompt template from ${opts.server}`,
      schema: {
        type: `object`,
        properties: {
          name: { type: `string` },
          arguments: { type: `object`, additionalProperties: true },
        },
        required: [`name`],
      },
      run: (args) =>
        withTimeout(
          opts.client.getPrompt(
            args as { name: string; arguments?: Record<string, unknown> }
          ),
          ms
        ),
    }),
  ]
}
