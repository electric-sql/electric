import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  extractSessionDeepLinkFromArgv,
  isSessionDeepLink,
  parseSessionDeepLink,
} from './deep-link'

test(`isSessionDeepLink matches only open-session links`, () => {
  assert.equal(
    isSessionDeepLink(`electric-agents://open-session?server=a&entity=b`),
    true
  )
  assert.equal(isSessionDeepLink(`electric-agents://oauth/callback`), false)
  assert.equal(isSessionDeepLink(`https://x.example`), false)
})

test(`parseSessionDeepLink extracts server and entity`, () => {
  assert.deepEqual(
    parseSessionDeepLink(
      `electric-agents://open-session?server=${encodeURIComponent(
        `https://host.example`
      )}&entity=${encodeURIComponent(`horton/abc`)}`
    ),
    { serverUrl: `https://host.example`, entityUrl: `/horton/abc` }
  )
})

test(`parseSessionDeepLink returns null on missing params`, () => {
  assert.equal(
    parseSessionDeepLink(`electric-agents://open-session?server=a`),
    null
  )
})

test(`extractSessionDeepLinkFromArgv finds the link argument`, () => {
  const link = `electric-agents://open-session?server=a&entity=b`
  assert.equal(
    extractSessionDeepLinkFromArgv([`/path/to/app`, `--foo`, link]),
    link
  )
  assert.equal(extractSessionDeepLinkFromArgv([`/path/to/app`]), null)
})
