import { resolve } from 'node:path'
import { defaultTransportFactory } from '../src/transports/factory'
import type { KeyVault } from '../src/vault/types'

export { defaultTransportFactory }

/**
 * No-op KeyVault implementation for tests that don't exercise auth.
 * Returns `null` for every `get`, accepts every `set`/`delete` silently,
 * and reports an empty list. Stdio transports never read from the vault.
 */
export function noopVault(): KeyVault {
  return {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    list: async () => [],
  }
}

/**
 * Absolute path to the stdio mock-MCP-server fixture (Task 15a).
 *
 * Use as the second positional arg to `npx tsx`/`tsx` when configuring an
 * `McpStdioConfig` in tests:
 *
 *     {
 *       transport: `stdio`,
 *       command: `npx`,
 *       args: [`tsx`, FIXTURE_PATH, `default`],
 *     }
 */
export const FIXTURE_PATH = resolve(__dirname, `./fixtures/mock-mcp-server.ts`)
