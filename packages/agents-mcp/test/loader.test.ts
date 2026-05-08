import { describe, expect, it } from 'vitest'
import { loadConfig, parseConfig } from '../src/config/loader'
import path from 'node:path'

const FIX = path.resolve(__dirname, `fixtures`)

describe(`loader`, () => {
  it(`parses a good config and expands env refs in args/url`, async () => {
    const cfg = await loadConfig(path.join(FIX, `mcp-good.json`), {
      HOME: `/h`,
    })
    expect(cfg.servers.length).toBe(3)
    const git = cfg.servers.find((s) => s.name === `git-local`)!
    expect(git.transport).toBe(`stdio`)
    expect((git as any).args).toContain(`/h/repo`)
  })

  it(`rejects unknown auth modes with a clear error`, () => {
    expect(() =>
      parseConfig({
        servers: {
          y: { transport: `stdio`, command: `true`, auth: { mode: `wat` } },
        },
      })
    ).toThrow(/auth.mode/)
  })

  it(`rejects http server without url`, () => {
    expect(() =>
      parseConfig({ servers: { x: { transport: `http` } } })
    ).toThrow(/url/)
  })

  it(`rejects unknown top-level fields (typo guard)`, () => {
    expect(() => parseConfig({ servers: {}, severs: {} })).toThrow(/severs/)
  })

  it(`refuses configs with secret refs (legacy schema rejected)`, () => {
    expect(() =>
      parseConfig({
        servers: {
          x: {
            transport: `http`,
            url: `https://x`,
            auth: { mode: `apiKey`, valueRef: `secret/api-key` },
          },
        },
      })
    ).toThrow(/valueRef/)
  })
})
