import { prefixToolName } from './tool-bridge'
import { withTimeout, DEFAULT_TIMEOUT_MS } from '../transports/timeout'
import type { BridgedTool } from './tool-bridge'

export interface BuildResourceToolsOpts {
  server: string
  client: {
    listResources: () => Promise<unknown>
    readResource: (args: { uri: string }) => Promise<unknown>
  }
  timeoutMs?: number
}

export function buildResourceTools(
  opts: BuildResourceToolsOpts
): BridgedTool[] {
  const ms = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return [
    {
      name: prefixToolName(opts.server, `list_resources`),
      server: opts.server,
      description: `List resources on ${opts.server}`,
      inputSchema: { type: `object`, properties: {} },
      call: () => withTimeout(opts.client.listResources(), ms),
    },
    {
      name: prefixToolName(opts.server, `read_resource`),
      server: opts.server,
      description: `Read a resource from ${opts.server}`,
      inputSchema: {
        type: `object`,
        properties: { uri: { type: `string` } },
        required: [`uri`],
      },
      call: (args) =>
        withTimeout(opts.client.readResource(args as { uri: string }), ms),
    },
  ]
}
