import { describe, expect, it } from 'vitest'
import { sessionAppUrl } from './sessionLinks'

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
})
