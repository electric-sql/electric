import { createServer, type IncomingMessage, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BuiltinAgentsServer } from '../src/server'

vi.mock(`@electric-ax/agents-runtime`, async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    createPullWakeRunner: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(async () => {}),
      waitForStopped: vi.fn(async () => {}),
      get running() {
        return false
      },
      get offset() {
        return undefined
      },
    })),
  }
})

const mockStreamFn = vi.fn(async function* () {}) as any

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Array<Buffer> = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString(`utf8`)
}

async function startRecordingAgentsServer(): Promise<{
  url: string
  entityTypeBodies: Array<Record<string, unknown>>
  stop: () => Promise<void>
}> {
  const entityTypeBodies: Array<Record<string, unknown>> = []
  const httpServer: Server = createServer(async (req, res) => {
    const body = await readBody(req)
    if (req.method === `POST` && req.url === `/_electric/entity-types`) {
      entityTypeBodies.push(JSON.parse(body) as Record<string, unknown>)
    }

    res.writeHead(200, { 'content-type': `application/json` })
    res.end(req.url?.includes(`/wake`) ? `[]` : `{}`)
  })

  await new Promise<void>((resolve) =>
    httpServer.listen(0, `127.0.0.1`, resolve)
  )
  const addr = httpServer.address()
  if (!addr || typeof addr === `string`) {
    throw new Error(`mock agents-server failed to bind`)
  }

  return {
    url: `http://127.0.0.1:${addr.port}`,
    entityTypeBodies,
    stop: () =>
      new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve()))
      ),
  }
}

describe(`BuiltinAgentsServer pull-wake registration`, () => {
  let builtinServer: BuiltinAgentsServer | null = null
  let agentsServer: Awaited<
    ReturnType<typeof startRecordingAgentsServer>
  > | null

  afterEach(async () => {
    await builtinServer?.stop()
    builtinServer = null
    await agentsServer?.stop().catch(() => {})
    agentsServer = null
  })

  it(`does not store the local pull-wake runner as a type default`, async () => {
    agentsServer = await startRecordingAgentsServer()
    builtinServer = new BuiltinAgentsServer({
      agentServerUrl: agentsServer.url,
      mockStreamFn,
      pullWake: { runnerId: `test-runner` },
    })

    await builtinServer.start()

    expect(agentsServer.entityTypeBodies.length).toBeGreaterThan(0)
    expect(
      agentsServer.entityTypeBodies.some(
        (body) => body.default_dispatch_policy !== undefined
      )
    ).toBe(false)
  })
})
