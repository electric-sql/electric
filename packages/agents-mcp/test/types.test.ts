import { describe, expect, it } from 'vitest'
import type {
  AddServerResult,
  McpAuthConfig,
  McpServerConfig,
  McpServerStatus,
} from '../src/types'

describe(`types`, () => {
  it(`AddServerResult discriminates on state`, () => {
    const ready: AddServerResult = { state: `ready`, id: `s`, toolCount: 3 }
    const auth: AddServerResult = {
      state: `authenticating`,
      id: `s`,
      authUrl: `https://x`,
    }
    const err: AddServerResult = {
      state: `error`,
      id: `s`,
      error: { kind: `transport_error`, message: `boom` },
    }
    expect([ready.state, auth.state, err.state]).toEqual([
      `ready`,
      `authenticating`,
      `error`,
    ])
  })

  it(`McpServerConfig http with apiKey allows headerName`, () => {
    const c: McpServerConfig = {
      name: `x`,
      transport: `http`,
      url: `https://x/mcp`,
      auth: { mode: `apiKey`, key: `KEY`, headerName: `X-Api-Key` },
    }
    expect(c.transport).toBe(`http`)
  })

  it(`McpServerStatus enum matches HTTP API contract`, () => {
    const s: McpServerStatus[] = [
      `connecting`,
      `authenticating`,
      `ready`,
      `error`,
      `disabled`,
    ]
    expect(s.length).toBe(5)
  })

  // Type-only sanity: authorizationCode is the only OAuth flow we support
  // now (browser-only, hosted by the desktop app).
  it(`authorizationCode mode accepts inline scopes / client / tokens`, () => {
    const a: McpAuthConfig = {
      mode: `authorizationCode`,
      scopes: [`x`],
    }
    expect(a.mode).toBe(`authorizationCode`)
  })
})
