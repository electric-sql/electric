import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveOpenSessionPayload } from './open-session'
import type { ServerConfig } from './types'

const server = (over: Partial<ServerConfig>): ServerConfig => ({
  id: `srv`,
  name: `Server`,
  url: `https://host.example`,
  source: `manual`,
  desiredState: `disconnected`,
  localRuntimeEnabled: false,
  ...over,
})

const link = (serverUrl: string, entity: string): string =>
  `electric-agents://open-session?server=${encodeURIComponent(
    serverUrl
  )}&entity=${encodeURIComponent(entity)}`

test(`resolveOpenSessionPayload matches a saved server by url`, () => {
  const servers = [server({ id: `a`, url: `https://host.example` })]
  assert.deepEqual(
    resolveOpenSessionPayload(
      servers,
      link(`https://host.example`, `horton/abc`)
    ),
    {
      serverId: `a`,
      serverUrl: `https://host.example`,
      entityUrl: `/horton/abc`,
    }
  )
})

test(`resolveOpenSessionPayload returns serverId null for an unknown server`, () => {
  const servers = [server({ id: `a`, url: `https://host.example` })]
  const payload = resolveOpenSessionPayload(
    servers,
    link(`https://other.example`, `horton/abc`)
  )
  assert.deepEqual(payload, {
    serverId: null,
    serverUrl: `https://other.example`,
    entityUrl: `/horton/abc`,
  })
})

test(`resolveOpenSessionPayload returns null for a malformed link`, () => {
  assert.equal(
    resolveOpenSessionPayload([], `electric-agents://oauth/callback`),
    null
  )
  assert.equal(resolveOpenSessionPayload([], `https://not-a-deep-link`), null)
})
