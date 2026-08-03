import { createServer, type IncomingMessage, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BuiltinAgentsServer } from '../src/server'

const pullWakeRunnerMocks = vi.hoisted(() => ({
  start: vi.fn(),
  reconnect: vi.fn(),
  stop: vi.fn(async () => {}),
  waitForStopped: vi.fn(async () => {}),
}))

vi.mock(`@electric-ax/agents-runtime`, async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    createPullWakeRunner: vi.fn(() => ({
      ...pullWakeRunnerMocks,
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
  requestUrls: Array<string>
  stop: () => Promise<void>
}> {
  const entityTypeBodies: Array<Record<string, unknown>> = []
  const requestUrls: Array<string> = []
  const httpServer: Server = createServer(async (req, res) => {
    const body = await readBody(req)
    requestUrls.push(req.url ?? ``)
    if (req.method === `POST` && req.url?.endsWith(`/_electric/entity-types`)) {
      entityTypeBodies.push(JSON.parse(body) as Record<string, unknown>)
    }
    if (req.method === `POST` && req.url?.endsWith(`/_electric/runners`)) {
      res.writeHead(201, { 'content-type': `application/json` })
      res.end(`{}`)
      return
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
    requestUrls,
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

  beforeEach(() => {
    pullWakeRunnerMocks.start.mockClear()
    pullWakeRunnerMocks.reconnect.mockClear()
    pullWakeRunnerMocks.stop.mockClear()
    pullWakeRunnerMocks.waitForStopped.mockClear()
  })

  afterEach(async () => {
    await builtinServer?.stop()
    builtinServer = null
    await agentsServer?.stop().catch(() => {})
    agentsServer = null
  })

  it(`stores the local pull-wake runner as the built-in type default`, async () => {
    agentsServer = await startRecordingAgentsServer()
    builtinServer = new BuiltinAgentsServer({
      agentServerUrl: agentsServer.url,
      mockStreamFn,
      durableStreamsFetchCache: false,
      pullWake: { runnerId: `test-runner` },
    })

    await builtinServer.start()

    expect(agentsServer.entityTypeBodies.length).toBeGreaterThan(0)
    for (const body of agentsServer.entityTypeBodies) {
      expect(body.default_dispatch_policy).toEqual({
        targets: [{ type: `runner`, runnerId: `test-runner` }],
      })
    }
  })

  it(`grants all users default built-in entity type permissions`, async () => {
    agentsServer = await startRecordingAgentsServer()
    builtinServer = new BuiltinAgentsServer({
      agentServerUrl: agentsServer.url,
      mockStreamFn,
      durableStreamsFetchCache: false,
      pullWake: { runnerId: `test-runner` },
    })

    await builtinServer.start()

    const horton = agentsServer.entityTypeBodies.find(
      (body) => body.name === `horton`
    )
    const worker = agentsServer.entityTypeBodies.find(
      (body) => body.name === `worker`
    )
    expect(horton?.permission_grants).toContainEqual({
      subject_kind: `principal_kind`,
      subject_value: `user`,
      permission: `spawn`,
    })
    expect(horton?.permission_grants).toContainEqual({
      subject_kind: `principal_kind`,
      subject_value: `user`,
      permission: `manage`,
    })
    expect(worker?.permission_grants).toContainEqual({
      subject_kind: `principal_kind`,
      subject_value: `user`,
      permission: `spawn`,
    })
    expect(worker?.permission_grants).toContainEqual({
      subject_kind: `principal_kind`,
      subject_value: `user`,
      permission: `manage`,
    })
  })

  it(`registers through tenant path-prefixed server URLs`, async () => {
    agentsServer = await startRecordingAgentsServer()
    builtinServer = new BuiltinAgentsServer({
      agentServerUrl: `${agentsServer.url}/t/svc-agent-1/v1`,
      mockStreamFn,
      durableStreamsFetchCache: false,
      pullWake: { runnerId: `test-runner`, registerRunner: true },
    })

    await builtinServer.start()

    expect(agentsServer.requestUrls).toContain(
      `/t/svc-agent-1/v1/_electric/entity-types`
    )
    expect(agentsServer.requestUrls).toContain(
      `/t/svc-agent-1/v1/_electric/runners`
    )
  })

  it(`reconnects the pull-wake runner without restarting the built-in runtime`, async () => {
    agentsServer = await startRecordingAgentsServer()
    builtinServer = new BuiltinAgentsServer({
      agentServerUrl: agentsServer.url,
      mockStreamFn,
      durableStreamsFetchCache: false,
      pullWake: { runnerId: `test-runner` },
    })
    await builtinServer.start()

    builtinServer.reconnectPullWake()

    expect(pullWakeRunnerMocks.reconnect).toHaveBeenCalledTimes(1)
    expect(pullWakeRunnerMocks.stop).not.toHaveBeenCalled()
  })

  it(`treats pull-wake reconnect as a no-op outside the running lifecycle`, async () => {
    agentsServer = await startRecordingAgentsServer()
    builtinServer = new BuiltinAgentsServer({
      agentServerUrl: agentsServer.url,
      mockStreamFn,
      durableStreamsFetchCache: false,
      pullWake: { runnerId: `test-runner` },
    })

    builtinServer.reconnectPullWake()
    expect(pullWakeRunnerMocks.reconnect).not.toHaveBeenCalled()

    await builtinServer.start()
    await builtinServer.stop()
    pullWakeRunnerMocks.reconnect.mockClear()
    builtinServer.reconnectPullWake()

    expect(pullWakeRunnerMocks.reconnect).not.toHaveBeenCalled()
  })
})
