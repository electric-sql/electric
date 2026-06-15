import { describe, expect, it } from 'vitest'
import { sessionIdFromEntityUrl, sessionWebUrl } from './sessionLinks'

describe(`sessionIdFromEntityUrl`, () => {
  it(`strips leading slashes from the entity url`, () => {
    expect(sessionIdFromEntityUrl(`/horton/abc`)).toBe(`horton/abc`)
    expect(sessionIdFromEntityUrl(`//horton/abc`)).toBe(`horton/abc`)
    expect(sessionIdFromEntityUrl(`horton/abc`)).toBe(`horton/abc`)
  })
})

describe(`sessionWebUrl`, () => {
  it(`builds a web UI link on a bare server origin`, () => {
    expect(sessionWebUrl(`https://host.example`, `/horton/abc`)).toBe(
      `https://host.example/__agent_ui/#/entity/horton/abc`
    )
  })

  it(`normalizes a trailing slash on the server url`, () => {
    expect(sessionWebUrl(`https://host.example/`, `/horton/abc`)).toBe(
      `https://host.example/__agent_ui/#/entity/horton/abc`
    )
  })

  it(`preserves a Cloud tenant path prefix`, () => {
    expect(
      sessionWebUrl(
        `https://agents.electric-sql.cloud/t/svc-123/v1`,
        `/horton/abc`
      )
    ).toBe(
      `https://agents.electric-sql.cloud/t/svc-123/v1/__agent_ui/#/entity/horton/abc`
    )
  })

  it(`drops query and hash from the server url`, () => {
    expect(
      sessionWebUrl(`https://host.example/base/?stale=1#old`, `/horton/abc`)
    ).toBe(`https://host.example/base/__agent_ui/#/entity/horton/abc`)
  })

  it(`keeps nested session ids un-encoded for the hash splat route`, () => {
    expect(sessionWebUrl(`https://host.example`, `/agent/foo/bar`)).toBe(
      `https://host.example/__agent_ui/#/entity/agent/foo/bar`
    )
  })

  it(`falls back to string concatenation for unparseable server urls`, () => {
    expect(sessionWebUrl(`not a url`, `/horton/abc`)).toBe(
      `not a url/__agent_ui/#/entity/horton/abc`
    )
  })
})
