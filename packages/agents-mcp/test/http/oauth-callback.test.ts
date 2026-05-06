import { describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { createRegistry } from '../../src/registry'
import { inMemoryCredentialStore } from '../../src/credentials/in-memory'
import { mountMcpHttp } from '../../src/http/mount'

describe(`GET /oauth/callback/:server`, () => {
  it(`completes auth via the registry hook and renders success`, async () => {
    const credentials = inMemoryCredentialStore()
    const reg = createRegistry({ credentials, publicUrl: `http://localhost:0` })
    const finishAuthSpy = vi.fn(async () => ({
      state: `ready`,
      id: `mock`,
      toolCount: 1,
    }))
    ;(reg as any).finishAuth = finishAuthSpy

    const server = http.createServer()
    mountMcpHttp({
      server,
      registry: reg,
      publicUrl: `http://localhost:0`,
      corsOrigin: `*`,
    })
    await new Promise<void>((r) => server.listen(0, r))
    const addr = server.address()!
    const port = typeof addr === `string` ? 0 : addr.port

    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/oauth/callback/mock?code=AC&state=S`
      )
      expect(res.status).toBe(200)
      expect(await res.text()).toMatch(/close this/i)
      expect(finishAuthSpy).toHaveBeenCalledWith(`mock`, `AC`, `S`)
    } finally {
      server.close()
    }
  })

  it(`renders a 400 when the provider returned an error`, async () => {
    const credentials = inMemoryCredentialStore()
    const reg = createRegistry({ credentials, publicUrl: `http://localhost:0` })
    const server = http.createServer()
    mountMcpHttp({
      server,
      registry: reg,
      publicUrl: `http://localhost:0`,
      corsOrigin: `*`,
    })
    await new Promise<void>((r) => server.listen(0, r))
    const addr = server.address()!
    const port = typeof addr === `string` ? 0 : addr.port
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/oauth/callback/mock?error=access_denied`
      )
      expect(res.status).toBe(400)
    } finally {
      server.close()
    }
  })
})
