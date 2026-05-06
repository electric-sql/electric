import { TimeoutError } from '../transports/timeout'
import type { BridgedTool } from './tool-bridge'

export interface PromptBridgeOpts {
  server: string
  invoke: (
    server: string,
    method: string,
    args: unknown,
    timeoutMs: number
  ) => Promise<unknown>
  timeoutMs: number
}

export function bridgePromptTools(opts: PromptBridgeOpts): BridgedTool[] {
  return [
    {
      name: `${opts.server}.list_prompts`,
      description: `List prompts exposed by ${opts.server}`,
      async run() {
        try {
          return await opts.invoke(
            opts.server,
            `prompts/list`,
            {},
            opts.timeoutMs
          )
        } catch (err) {
          return {
            error: {
              kind: err instanceof TimeoutError ? `timeout` : `transport_error`,
              server: opts.server,
              detail: String(err),
            },
          }
        }
      },
    },
    {
      name: `${opts.server}.get_prompt`,
      description: `Get a prompt by name from ${opts.server}`,
      async run(args) {
        try {
          const a = args as { name: string; arguments?: Record<string, string> }
          return await opts.invoke(
            opts.server,
            `prompts/get`,
            { name: a.name, arguments: a.arguments },
            opts.timeoutMs
          )
        } catch (err) {
          return {
            error: {
              kind: err instanceof TimeoutError ? `timeout` : `transport_error`,
              server: opts.server,
              detail: String(err),
            },
          }
        }
      },
    },
  ]
}
