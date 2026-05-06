import { describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { createRegistry } from '../../src/registry'
import { inMemoryCredentialStore } from '../../src/credentials/in-memory'
import { mountMcpHttp } from '../../src/http/mount'

async function startServer(
  reg: ReturnType<typeof createRegistry>,
  publicUrl = `http://localhost:0`
) {
  const server = http.createServer()
  mountMcpHttp({
    server,
    registry: reg,
    publicUrl,
    corsOrigin: `*`,
  })
  await new Promise<void>((r) => server.listen(0, r))
  const addr = server.address()
  if (!addr || typeof addr === `string`) throw new Error(`no addr`)
  return { server, base: `http://127.0.0.1:${addr.port}` }
}

function makeFakeTransport(toolNames: string[] = [`t1`]) {
  return {
    client: {
      listTools: async () => ({
        tools: toolNames.map((name) => ({
          name,
          description: name,
          inputSchema: { type: `object` },
        })),
      }),
      callTool: async () => ({ content: [{ type: `text`, text: `ok` }] }),
      close: async () => {},
    } as any,
    connect: async () => {},
    close: vi.fn(),
  }
}

async function startReadyServer() {
  const credentials = inMemoryCredentialStore()
  credentials.setApiKey(`mock`, `KEY`)
  const reg = createRegistry({
    credentials,
    transportFactoryOverride: () => makeFakeTransport(),
  })
  await reg.addServer({
    name: `mock`,
    transport: `http`,
    url: `https://mock/mcp`,
    auth: { mode: `apiKey` },
  })
  const { server, base } = await startServer(reg)
  return { server, base, reg }
}

describe(`mountMcpHttp — Phase 1 surface`, () => {
  it(`GET /api/mcp/servers returns []`, async () => {
    const reg = createRegistry({ credentials: inMemoryCredentialStore() })
    const { server, base } = await startServer(reg)
    try {
      const res = await fetch(`${base}/api/mcp/servers`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { servers: unknown[] }
      expect(body.servers).toEqual([])
    } finally {
      server.close()
    }
  })

  it(`POST /api/mcp/servers returns AddServerResult envelope`, async () => {
    const credentials = inMemoryCredentialStore()
    credentials.setApiKey(`mock`, `KEY`)
    const reg = createRegistry({
      credentials,
      transportFactoryOverride: () => ({
        client: {
          listTools: async () => ({
            tools: [{ name: `t`, inputSchema: { type: `object` } }],
          }),
          callTool: async () => ({ content: [] }),
          close: async () => {},
        } as any,
        connect: async () => {},
        close: async () => {},
      }),
    })
    const { server, base } = await startServer(reg)
    try {
      const res = await fetch(`${base}/api/mcp/servers`, {
        method: `POST`,
        headers: { 'Content-Type': `application/json` },
        body: JSON.stringify({
          name: `mock`,
          transport: `http`,
          url: `https://mock/mcp`,
          auth: { mode: `apiKey` },
        }),
      })
      const body = (await res.json()) as { state: string }
      expect(body.state).toBe(`ready`)
    } finally {
      server.close()
    }
  })

  it(`CORS preflight returns 204 with allowed origin`, async () => {
    const reg = createRegistry({ credentials: inMemoryCredentialStore() })
    const { server, base } = await startServer(reg)
    try {
      const res = await fetch(`${base}/api/mcp/servers`, {
        method: `OPTIONS`,
        headers: { origin: `http://example` },
      })
      expect(res.status).toBe(204)
      expect(res.headers.get(`access-control-allow-origin`)).toBe(`*`)
    } finally {
      server.close()
    }
  })
})

describe(`mountMcpHttp — action endpoints`, () => {
  it(`POST /api/mcp/servers/:name/disable sets status to disabled`, async () => {
    const { server, base } = await startReadyServer()
    try {
      const res = await fetch(`${base}/api/mcp/servers/mock/disable`, {
        method: `POST`,
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; status: string }
      expect(body.ok).toBe(true)
      expect(body.status).toBe(`disabled`)
    } finally {
      server.close()
    }
  })

  it(`POST /api/mcp/servers/:name/enable restores a disabled server`, async () => {
    const { server, base, reg } = await startReadyServer()
    try {
      await reg.disable(`mock`)
      const res = await fetch(`${base}/api/mcp/servers/mock/enable`, {
        method: `POST`,
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { state: string }
      expect(body.state).toBe(`ready`)
    } finally {
      server.close()
    }
  })

  it(`POST /api/mcp/servers/:name/authorize re-adds the server`, async () => {
    const { server, base } = await startReadyServer()
    try {
      const res = await fetch(`${base}/api/mcp/servers/mock/authorize`, {
        method: `POST`,
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { state: string }
      expect(body.state).toBe(`ready`)
    } finally {
      server.close()
    }
  })
})

describe(`mountMcpHttp — device flow endpoint`, () => {
  it(`POST /oauth/device/:server/start returns authenticating with deviceCode.userCode`, async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes(`device_authorization`)) {
        return new Response(
          JSON.stringify({
            device_code: `DEV`,
            user_code: `MOUNT-1234`,
            verification_uri: `https://x/device`,
            expires_in: 600,
            interval: 0,
          })
        )
      }
      return new Response(JSON.stringify({ error: `authorization_pending` }), {
        status: 400,
      })
    })
    const credentials = inMemoryCredentialStore()
    credentials.setClientCredentials(`devmock`, {
      clientId: `cid`,
      clientSecret: `sec`,
    })
    const reg = createRegistry({
      credentials,
      publicUrl: `http://localhost:0`,
      deviceFlowFetch: fetchImpl,
    })
    // Pre-register the server so mount can look it up
    await reg.addServer({
      name: `devmock`,
      transport: `http`,
      url: `https://devmock/mcp`,
      auth: {
        mode: `authorizationCode`,
        flow: `device`,
        scopes: [`mcp:read`],
        // @ts-expect-error — extension for device flow
        deviceEndpoints: {
          deviceAuthorizationEndpoint: `https://x/device_authorization`,
          tokenEndpoint: `https://x/token`,
        },
      },
    })
    const { server, base } = await startServer(reg)
    try {
      const res = await fetch(`${base}/oauth/device/devmock/start`, {
        method: `POST`,
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        state: string
        deviceCode?: { userCode: string }
      }
      expect(body.state).toBe(`authenticating`)
      expect(body.deviceCode?.userCode).toBe(`MOUNT-1234`)
    } finally {
      server.close()
      await reg.removeServer(`devmock`)
    }
  })
})
