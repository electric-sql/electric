import { TimeoutError } from '../transports/timeout'
import type { BridgedTool } from './tool-bridge'

export interface ResourceBridgeOpts {
  server: string
  invoke: (
    server: string,
    method: string,
    args: unknown,
    timeoutMs: number
  ) => Promise<unknown>
  timeoutMs: number
}

export function bridgeResourceTools(opts: ResourceBridgeOpts): BridgedTool[] {
  return [
    {
      name: `${opts.server}.list_resources`,
      description: `List resources exposed by ${opts.server}`,
      async run() {
        try {
          return await opts.invoke(
            opts.server,
            `resources/list`,
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
      name: `${opts.server}.read_resource`,
      description: `Read a resource by URI from ${opts.server}`,
      async run(args) {
        try {
          return await opts.invoke(
            opts.server,
            `resources/read`,
            { uri: (args as { uri: string }).uri },
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
