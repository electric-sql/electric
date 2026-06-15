import { describe, expect, it } from 'vitest'
import {
  isSessionDeepLink,
  parseSessionDeepLink,
  sessionAppUrl,
  sessionIdFromEntityUrl,
  sessionWebUrl,
} from './sessionLinks'

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

describe(`sessionAppUrl`, () => {
  it(`builds an app deep link with encoded server and entity`, () => {
    expect(sessionAppUrl(`https://host.example`, `/horton/abc`)).toBe(
      `electric-agents://open-session?server=https%3A%2F%2Fhost.example&entity=horton%2Fabc`
    )
  })

  it(`preserves a Cloud tenant path prefix in the server param`, () => {
    expect(
      sessionAppUrl(`https://agents.electric-sql.cloud/t/svc-123/v1`, `/x/y`)
    ).toBe(
      `electric-agents://open-session?server=https%3A%2F%2Fagents.electric-sql.cloud%2Ft%2Fsvc-123%2Fv1&entity=x%2Fy`
    )
  })
})

describe(`isSessionDeepLink`, () => {
  it(`accepts the canonical form`, () => {
    expect(
      isSessionDeepLink(`electric-agents://open-session?server=a&entity=b`)
    ).toBe(true)
  })
  it(`accepts the single-slash Android variant`, () => {
    expect(
      isSessionDeepLink(`electric-agents:/open-session?server=a&entity=b`)
    ).toBe(true)
  })
  it(`rejects the oauth callback and other schemes`, () => {
    expect(isSessionDeepLink(`electric-agents://oauth/callback?x=1`)).toBe(
      false
    )
    expect(isSessionDeepLink(`https://host.example/x`)).toBe(false)
  })
})

describe(`parseSessionDeepLink`, () => {
  it(`round-trips a built link`, () => {
    const url = sessionAppUrl(`https://host.example`, `/horton/abc`)
    expect(parseSessionDeepLink(url)).toEqual({
      serverUrl: `https://host.example`,
      entityUrl: `/horton/abc`,
    })
  })
  it(`normalizes a missing leading slash on entity`, () => {
    expect(
      parseSessionDeepLink(
        `electric-agents://open-session?server=https%3A%2F%2Fh.example&entity=horton%2Fabc`
      )
    ).toEqual({ serverUrl: `https://h.example`, entityUrl: `/horton/abc` })
  })
  it(`returns null when a param is missing`, () => {
    expect(
      parseSessionDeepLink(`electric-agents://open-session?server=a`)
    ).toBeNull()
    expect(parseSessionDeepLink(`electric-agents://oauth/callback`)).toBeNull()
  })
})
