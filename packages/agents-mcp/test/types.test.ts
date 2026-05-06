import { describe, expect, it } from 'vitest'
import type {
  McpServerConfig,
  McpAuthMode,
  McpToolError,
  McpServerStatus,
} from '../src/types'

describe(`types`, () => {
  it(`McpAuthMode enumerates expected modes`, () => {
    const modes: McpAuthMode[] = [
      `apiKey`,
      `clientCredentials`,
      `authorizationCode`,
    ]
    expect(modes).toHaveLength(3)
  })
  it(`McpToolError categories`, () => {
    const errs: McpToolError[`kind`][] = [
      `auth_unavailable`,
      `transport_error`,
      `timeout`,
      `server_error`,
      `tool_not_found`,
      `schema_violation`,
    ]
    expect(errs).toHaveLength(6)
  })
  it(`McpServerConfig + McpServerStatus referenced`, () => {
    const cfg: McpServerConfig = { transport: `stdio`, command: `echo` }
    const status: McpServerStatus = `healthy`
    expect(cfg.transport).toBe(`stdio`)
    expect(status).toBe(`healthy`)
  })
})
