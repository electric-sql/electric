import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  serverFetch: vi.fn(),
}))

vi.mock(`@electric-ax/agents-server-ui/src/lib/auth-fetch`, () => ({
  serverFetch: mocks.serverFetch,
}))

function lastRequestBody(): Record<string, unknown> {
  const [, init] = mocks.serverFetch.mock.calls.at(-1)!
  return JSON.parse((init as RequestInit).body as string)
}

describe(`spawnEntity`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.serverFetch.mockResolvedValue(new Response(`{}`, { status: 200 }))
  })

  it(`sends a minimal body when nothing optional is set`, async () => {
    const { spawnEntity } = await import(`./agentsClient`)
    await spawnEntity({ baseUrl: `http://server`, type: `horton` })

    expect(lastRequestBody()).toEqual({})
  })

  it(`pins dispatch to the runner and forwards the working directory`, async () => {
    const { spawnEntity } = await import(`./agentsClient`)
    const entityUrl = await spawnEntity({
      baseUrl: `http://server`,
      type: `horton`,
      initialMessage: `hello`,
      runnerId: `runner-1`,
      sandboxProfile: `local`,
      workingDirectory: `/home/me/proj`,
    })

    const body = lastRequestBody()
    expect(body.initialMessage).toBe(`hello`)
    expect(body.dispatch_policy).toEqual({
      targets: [{ type: `runner`, runnerId: `runner-1` }],
    })
    expect(body.args).toEqual({ workingDirectory: `/home/me/proj` })
    // Sandbox keyed by the session URL for a persistent, shared
    // workspace — mirrors the desktop spawn path.
    expect(body.sandbox).toEqual({ profile: `local`, key: entityUrl })
  })

  it(`sends the sandbox profile without args when no directory is chosen`, async () => {
    const { spawnEntity } = await import(`./agentsClient`)
    await spawnEntity({
      baseUrl: `http://server`,
      type: `horton`,
      runnerId: `runner-1`,
      sandboxProfile: `docker`,
    })

    const body = lastRequestBody()
    expect(body.sandbox).toMatchObject({ profile: `docker` })
    expect(body.args).toBeUndefined()
  })

  it(`forwards a structured composer_input payload with its message type`, async () => {
    const { spawnEntity } = await import(`./agentsClient`)
    const payload = {
      source: `/quickstart go`,
      nodes: [
        {
          kind: `slash_command` as const,
          start: 0,
          end: 11,
          raw: `/quickstart`,
          name: `quickstart`,
        },
      ],
    }
    await spawnEntity({
      baseUrl: `http://server`,
      type: `horton`,
      initialMessage: payload,
      initialMessageType: `composer_input`,
    })

    const body = lastRequestBody()
    expect(body.initialMessage).toEqual(payload)
    expect(body.initialMessageType).toBe(`composer_input`)
  })

  it(`merges caller args with the working directory`, async () => {
    const { spawnEntity } = await import(`./agentsClient`)
    await spawnEntity({
      baseUrl: `http://server`,
      type: `horton`,
      args: { model: `opus`, reasoning: `high` },
      workingDirectory: `/home/me/proj`,
    })

    expect(lastRequestBody().args).toEqual({
      model: `opus`,
      reasoning: `high`,
      workingDirectory: `/home/me/proj`,
    })
  })
})

describe(`schemas`, () => {
  it(`parses runner rows with advertised sandbox profiles`, async () => {
    const { runnerSchema } = await import(`./agentsClient`)
    const runner = runnerSchema.parse({
      id: `r1`,
      owner_principal: `/principal/user%3Ame`,
      label: `Desktop`,
      kind: `local`,
      admin_status: `enabled`,
      sandbox_profiles: [
        { name: `local`, label: `Local` },
        { name: `cloud`, label: `Cloud`, remote: true },
      ],
    })
    expect(runner.sandbox_profiles.map((p) => p.name)).toEqual([
      `local`,
      `cloud`,
    ])
  })

  it(`coerces a missing/null sandbox_profiles column to an empty list`, async () => {
    const { runnerSchema } = await import(`./agentsClient`)
    const runner = runnerSchema.parse({
      id: `r1`,
      owner_principal: `/principal/user%3Ame`,
      label: `Desktop`,
      kind: `local`,
      admin_status: `enabled`,
      sandbox_profiles: null,
    })
    expect(runner.sandbox_profiles).toEqual([])
  })

  it(`parses entity rows with a runner dispatch policy`, async () => {
    const { entitySchema } = await import(`./agentsClient`)
    const entity = entitySchema.parse({
      url: `/horton/x`,
      type: `horton`,
      status: `idle`,
      spawn_args: { workingDirectory: `/home/me/proj` },
      dispatch_policy: { targets: [{ type: `runner`, runnerId: `r1` }] },
      parent: null,
      created_at: 1,
      updated_at: 2,
    })
    expect(entity.dispatch_policy?.targets[0]?.runnerId).toBe(`r1`)
  })
})
