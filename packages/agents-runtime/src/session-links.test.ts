import { describe, expect, it } from 'vitest'
import {
  extractSessionDeepLinkFromArgv,
  isSessionDeepLink,
  parseSessionDeepLink,
  sessionAppUrl,
  sessionIdFromEntityUrl,
} from './session-links'

describe(`sessionIdFromEntityUrl`, () => {
  it(`strips leading slashes from the entity url`, () => {
    expect(sessionIdFromEntityUrl(`/horton/abc`)).toBe(`horton/abc`)
    expect(sessionIdFromEntityUrl(`//horton/abc`)).toBe(`horton/abc`)
    expect(sessionIdFromEntityUrl(`horton/abc`)).toBe(`horton/abc`)
  })
})

describe(`sessionAppUrl`, () => {
  it(`builds an app deep link with encoded server and entity`, () => {
    expect(sessionAppUrl(`https://host.example`, `/horton/abc`)).toBe(
      `electric-agents://open-session?server=https%3A%2F%2Fhost.example&entity=horton%2Fabc`
    )
  })

  it(`strips a trailing slash from the server url`, () => {
    expect(sessionAppUrl(`https://host.example/`, `horton/abc`)).toBe(
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

  it(`accepts a bare host with no query`, () => {
    expect(isSessionDeepLink(`electric-agents://open-session`)).toBe(true)
    expect(isSessionDeepLink(`electric-agents://open-session/`)).toBe(true)
  })

  it(`rejects a host that only shares our prefix`, () => {
    // Boundary check — must not match `open-session` followed by more chars.
    expect(
      isSessionDeepLink(`electric-agents://open-sessionfoo?server=a&entity=b`)
    ).toBe(false)
    expect(isSessionDeepLink(`electric-agents://open-session-x`)).toBe(false)
  })

  it(`rejects the oauth callback and other schemes`, () => {
    expect(isSessionDeepLink(`electric-agents://oauth/callback?x=1`)).toBe(
      false
    )
    expect(isSessionDeepLink(`https://host.example/x`)).toBe(false)
    expect(isSessionDeepLink(`electric-agentsx://open-session`)).toBe(false)
  })

  it(`rejects non-string input`, () => {
    // @ts-expect-error exercising the runtime guard
    expect(isSessionDeepLink(undefined)).toBe(false)
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

  it(`round-trips a Cloud tenant-prefixed server`, () => {
    const server = `https://agents.electric-sql.cloud/t/svc-123/v1`
    const url = sessionAppUrl(server, `/agent/foo/bar`)
    expect(parseSessionDeepLink(url)).toEqual({
      serverUrl: server,
      entityUrl: `/agent/foo/bar`,
    })
  })

  it(`normalizes a missing leading slash on entity`, () => {
    expect(
      parseSessionDeepLink(
        `electric-agents://open-session?server=https%3A%2F%2Fh.example&entity=horton%2Fabc`
      )
    ).toEqual({ serverUrl: `https://h.example`, entityUrl: `/horton/abc` })
  })

  it(`parses the single-slash Android variant`, () => {
    expect(
      parseSessionDeepLink(
        `electric-agents:/open-session?server=https%3A%2F%2Fh.example&entity=x`
      )
    ).toEqual({ serverUrl: `https://h.example`, entityUrl: `/x` })
  })

  it(`returns null when a param is missing`, () => {
    expect(
      parseSessionDeepLink(`electric-agents://open-session?server=a`)
    ).toBeNull()
    expect(parseSessionDeepLink(`electric-agents://oauth/callback`)).toBeNull()
    expect(parseSessionDeepLink(`electric-agents://open-session`)).toBeNull()
  })
})

describe(`extractSessionDeepLinkFromArgv`, () => {
  it(`finds the link argument`, () => {
    const link = `electric-agents://open-session?server=a&entity=b`
    expect(
      extractSessionDeepLinkFromArgv([`/path/to/app`, `--foo`, link])
    ).toBe(link)
  })

  it(`returns null when no argument is a link`, () => {
    expect(extractSessionDeepLinkFromArgv([`/path/to/app`])).toBeNull()
  })
})
