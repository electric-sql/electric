import type { McpServerConfig } from '../types'
import type { McpTransportHandle } from './types'
import { createStdioTransport } from './stdio'
import { createHttpTransport, type GetAuthHeader } from './http'

/**
 * Default transport factory that the bootstrap layer and registry tests use.
 * Routes stdio configs to {@link createStdioTransport} and http configs to
 * {@link createHttpTransport}, threading the registry's auth-header adapter
 * through to the HTTP transport.
 */
export function defaultTransportFactory(
  _name: string,
  cfg: McpServerConfig,
  getAuthHeader: GetAuthHeader
): McpTransportHandle {
  if (cfg.transport === `stdio`) return createStdioTransport(cfg)
  return createHttpTransport(cfg, getAuthHeader)
}
