import { describe, expect, it } from 'vitest'
import { decideOpenSession } from './openSessionDecision'

const SELF_HOSTED = `https://my.server.example`
const CLOUD = `https://agents.electric-sql.cloud/t/svc-123/v1`

function decide(overrides: Partial<Parameters<typeof decideOpenSession>[0]>) {
  return decideOpenSession({
    target: { serverUrl: SELF_HOSTED, entityUrl: `/horton/abc` },
    activeServerUrl: SELF_HOSTED,
    isCloudServer: (url) => url.includes(`electric-sql.cloud`),
    isSavedServer: () => false,
    ...overrides,
  })
}

describe(`decideOpenSession`, () => {
  it(`abandons when there's no parsed link`, () => {
    expect(decide({ target: null })).toEqual({ kind: `abandon` })
  })

  it(`routes when the link's server is already active`, () => {
    expect(decide({ activeServerUrl: SELF_HOSTED })).toEqual({
      kind: `route`,
      entityUrl: `/horton/abc`,
    })
  })

  it(`treats a trailing-slash difference as the same active server`, () => {
    expect(
      decide({
        target: { serverUrl: `${SELF_HOSTED}/`, entityUrl: `/x` },
        activeServerUrl: SELF_HOSTED,
      })
    ).toEqual({ kind: `route`, entityUrl: `/x` })
  })

  it(`abandons a Cloud server that isn't already active (needs sign-in)`, () => {
    expect(
      decide({
        target: { serverUrl: CLOUD, entityUrl: `/x` },
        activeServerUrl: SELF_HOSTED,
      })
    ).toEqual({ kind: `abandon` })
  })

  it(`switches to a self-hosted server the user has already added`, () => {
    expect(
      decide({ activeServerUrl: null, isSavedServer: () => true })
    ).toEqual({ kind: `switch`, serverUrl: SELF_HOSTED })
  })

  it(`refuses an unknown self-hosted server instead of adding it silently`, () => {
    expect(
      decide({ activeServerUrl: null, isSavedServer: () => false })
    ).toEqual({ kind: `refuse`, host: `my.server.example` })
  })

  it(`refuses by host even when the active server is a different one`, () => {
    expect(
      decide({
        activeServerUrl: `https://other.example`,
        isSavedServer: () => false,
      })
    ).toEqual({ kind: `refuse`, host: `my.server.example` })
  })
})
