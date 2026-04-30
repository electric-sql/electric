import { describe, it, expect } from 'vitest'
import type { CodingAgentHandle, SpawnCodingAgentOptions } from '../src/types'

describe(`ctx.spawnCodingAgent contract`, () => {
  it(`exports SpawnCodingAgentOptions with \`claude\` kind`, () => {
    const opts: SpawnCodingAgentOptions = {
      id: `x`,
      kind: `claude`,
      workspace: { type: `volume` },
    }
    expect(opts.kind).toBe(`claude`)
  })
  it(`CodingAgentHandle has the expected method shape`, () => {
    const noopHandle: CodingAgentHandle = {
      url: `/x`,
      kind: `claude`,
      send: async () => ({ runId: `r` }),
      events: async function* () {},
      state: () => ({
        status: `cold`,
        pinned: false,
        workspace: { identity: ``, sharedRefs: 1 },
        runs: [],
      }),
      pin: async () => undefined,
      release: async () => undefined,
      stop: async () => undefined,
      destroy: async () => undefined,
    }
    expect(noopHandle.kind).toBe(`claude`)
  })
})
