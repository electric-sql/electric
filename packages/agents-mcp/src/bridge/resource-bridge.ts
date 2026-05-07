import { prefixToolName, makeSyntheticBridgedTool } from './tool-bridge'
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
    makeSyntheticBridgedTool({
      name: prefixToolName(opts.server, `list_resources`),
      server: opts.server,
      label: `list_resources`,
      description: `List resources on ${opts.server}`,
      schema: { type: `object`, properties: {}, required: [] },
      run: () => withTimeout(opts.client.listResources(), ms),
    }),
    makeSyntheticBridgedTool({
      name: prefixToolName(opts.server, `read_resource`),
      server: opts.server,
      label: `read_resource`,
      description: `Read a resource from ${opts.server}`,
      schema: {
        type: `object`,
        properties: { uri: { type: `string` } },
        required: [`uri`],
      },
      run: (args) =>
        withTimeout(opts.client.readResource(args as { uri: string }), ms),
    }),
  ]
}
