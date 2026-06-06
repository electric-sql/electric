import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAgentsToken: vi.fn(),
  getState: vi.fn(),
  registerActiveBaseUrl: vi.fn(),
  registerActiveServerHeaders: vi.fn(),
}))

vi.mock(`./cloudAuth`, () => {
  return {
    cloudAuth: {
      getAgentsToken: mocks.getAgentsToken,
      getState: mocks.getState,
    },
  }
})

vi.mock(`@electric-ax/agents-server-ui/src/lib/auth-fetch`, () => ({
  registerActiveServerHeaders: mocks.registerActiveServerHeaders,
}))

vi.mock(`@electric-ax/agents-server-ui/src/lib/entity-connection`, () => ({
  registerActiveBaseUrl: mocks.registerActiveBaseUrl,
}))

describe(`prepareServerHeaders`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAgentsToken.mockResolvedValue(`agents-token`)
    mocks.getState.mockReturnValue({ userId: `user-1` })
  })

  it(`exchanges tokens for tenant-path Cloud server URLs`, async () => {
    const { prepareServerHeaders } = await import(`./serverHeaders`)
    const serverUrl = `https://agents.example/t/svc-123/v1`

    await prepareServerHeaders(serverUrl)

    expect(mocks.getAgentsToken).toHaveBeenCalledWith(`svc-123`)
    expect(mocks.registerActiveBaseUrl).toHaveBeenCalledWith(serverUrl)
    expect(mocks.registerActiveServerHeaders).toHaveBeenCalledWith({
      url: serverUrl,
      headers: {
        authorization: `Bearer agents-token`,
        'electric-principal': `user:user-1`,
      },
    })
    expect(
      mocks.registerActiveServerHeaders.mock.calls[0]?.[0]?.headers
    ).not.toHaveProperty(`x-electric-service`)
  })

  it(`treats old query-routed URLs as local server URLs`, async () => {
    const { prepareServerHeaders } = await import(`./serverHeaders`)
    const serverUrl = `https://agents.example/?service=svc-123`

    await prepareServerHeaders(serverUrl)

    expect(mocks.getAgentsToken).not.toHaveBeenCalled()
    expect(mocks.registerActiveBaseUrl).toHaveBeenCalledWith(serverUrl)
    expect(mocks.registerActiveServerHeaders).toHaveBeenCalledWith(null)
  })
})
