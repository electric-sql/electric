import { describe, expect, it, vi } from 'vitest'
import { EntityManager } from '../src/entity-manager'

/**
 * A profile a runner advertises: a bare string is a host-local profile
 * (the common case); `{ name, remote: true }` marks an off-host
 * (remote-provider) profile that the co-location guard should not pin.
 */
type ProfileSpec = string | { name: string; remote?: boolean }

interface BuildManagerOpts {
  /**
   * Map of runner id → sandbox profiles the runner advertises. Used to
   * resolve `getRunner(id)` and to provide the tenant-wide
   * `listSandboxProfiles` fallback for unpinned dispatch.
   */
  runners: Record<string, Array<ProfileSpec>>
  /** Pre-existing entities keyed by URL — used to resolve `parent` for inherit. */
  entities?: Record<string, unknown>
}

function normalizeProfile(spec: ProfileSpec): {
  name: string
  label: string
  remote?: boolean
} {
  return typeof spec === `string`
    ? { name: spec, label: spec }
    : {
        name: spec.name,
        label: spec.name,
        ...(spec.remote !== undefined && { remote: spec.remote }),
      }
}

function buildManager({ runners, entities = {} }: BuildManagerOpts) {
  const createEntity = vi.fn().mockResolvedValue(1)
  const allProfiles = Object.values(runners).flat().map(normalizeProfile)
  const allProfileNames = [...new Set(allProfiles.map((p) => p.name))]
  return {
    createEntity,
    manager: new EntityManager({
      registry: {
        getEntityType: vi.fn().mockResolvedValue({
          name: `horton`,
          description: `test`,
          created_at: `2024-01-01`,
          updated_at: `2024-01-01`,
          revision: 1,
        }),
        getEntity: vi.fn(async (url: string) => entities[url] ?? null),
        getRunner: vi.fn(async (id: string) => {
          const specs = runners[id]
          return specs
            ? {
                id,
                owner_principal: `/principal/user%3Atest`,
                label: id,
                kind: `local`,
                admin_status: `enabled`,
                wake_stream: `/runners/${id}/wake`,
                sandbox_profiles: specs.map(normalizeProfile),
                created_at: `2024-01-01`,
                updated_at: `2024-01-01`,
              }
            : null
        }),
        listSandboxProfileNames: vi.fn().mockResolvedValue(allProfileNames),
        listSandboxProfiles: vi.fn().mockResolvedValue(allProfiles),
        createEntity,
        deleteEntity: vi.fn().mockResolvedValue(undefined),
      } as any,
      streamClient: {
        create: vi.fn().mockResolvedValue(undefined),
        append: vi.fn().mockResolvedValue({ offset: `0001` }),
        delete: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(true),
      } as any,
      validator: { validate: vi.fn().mockReturnValue(null) } as any,
      wakeRegistry: {
        register: vi.fn().mockResolvedValue(undefined),
        unregisterBySubscriberAndSource: vi.fn().mockResolvedValue(undefined),
        setTimeoutCallback: vi.fn(),
        setDebounceCallback: vi.fn(),
      } as any,
    }),
  }
}

const runnerDispatch = (runnerId: string) =>
  ({
    targets: [{ type: `runner` as const, runnerId }],
  }) as const

describe(`EntityManager.spawn sandbox profile validation`, () => {
  it(`rejects a profile not advertised by the pinned runner`, async () => {
    const { manager } = buildManager({
      runners: { 'runner-a': [`local`, `docker`] },
    })

    await expect(
      manager.spawn(`horton`, {
        instance_id: `t1`,
        dispatch_policy: runnerDispatch(`runner-a`),
        sandbox: { profile: `bogus` },
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        `sandbox profile "bogus" is not advertised by runner "runner-a"`
      ),
    })
  })

  it(`rejects a profile the target runner doesn't advertise even if another does`, async () => {
    const { manager } = buildManager({
      runners: {
        'runner-a': [`local`, `docker`],
        'runner-b': [`local`],
      },
    })

    await expect(
      manager.spawn(`horton`, {
        instance_id: `t1`,
        dispatch_policy: runnerDispatch(`runner-b`),
        sandbox: { profile: `docker` },
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        `sandbox profile "docker" is not advertised by runner "runner-b"`
      ),
    })
  })

  it(`accepts a profile the pinned runner advertises and persists it`, async () => {
    const { manager, createEntity } = buildManager({
      runners: { 'runner-a': [`local`, `docker`] },
    })

    await manager.spawn(`horton`, {
      instance_id: `t1`,
      dispatch_policy: runnerDispatch(`runner-a`),
      sandbox: { profile: `docker` },
    })

    expect(createEntity).toHaveBeenCalledWith(
      expect.objectContaining({ sandbox: { profile: `docker` } })
    )
  })

  it(`falls back to tenant-wide check for unpinned dispatch (no runner target)`, async () => {
    const { manager } = buildManager({
      runners: { 'runner-a': [`local`] },
    })

    await expect(
      manager.spawn(`horton`, {
        instance_id: `t1`,
        // No dispatch_policy → unpinned
        sandbox: { profile: `docker` },
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        `sandbox profile "docker" is not offered by any registered runner`
      ),
    })
  })

  it(`accepts unpinned dispatch when some runner offers the profile`, async () => {
    const { manager, createEntity } = buildManager({
      runners: { 'runner-a': [`local`, `docker`] },
    })

    await manager.spawn(`horton`, {
      instance_id: `t1`,
      sandbox: { profile: `docker` },
    })

    expect(createEntity).toHaveBeenCalledWith(
      expect.objectContaining({ sandbox: { profile: `docker` } })
    )
  })

  it(`leaves sandbox unset when the spawn doesn't pick one`, async () => {
    const { manager, createEntity } = buildManager({
      runners: { 'runner-a': [`local`, `docker`] },
    })

    await manager.spawn(`horton`, {
      instance_id: `t1`,
      dispatch_policy: runnerDispatch(`runner-a`),
    })

    expect(createEntity).toHaveBeenCalledWith(
      expect.objectContaining({ sandbox: undefined })
    )
  })
})

describe(`EntityManager.spawn shared sandbox (key / inherit)`, () => {
  const parentWithSharedSandbox = (runnerId: string) => ({
    '/horton/parent': {
      type: `horton`,
      status: `idle`,
      url: `/horton/parent`,
      streams: { main: `/horton/parent/main`, error: `/horton/parent/error` },
      tags: {},
      dispatch_policy: runnerDispatch(runnerId),
      sandbox: { profile: `docker`, key: `session-1` },
      created_at: 1,
      updated_at: 1,
    },
  })

  it(`persists an explicit shared key alongside the profile`, async () => {
    const { manager, createEntity } = buildManager({
      runners: { 'runner-a': [`local`, `docker`] },
    })

    await manager.spawn(`horton`, {
      instance_id: `t1`,
      dispatch_policy: runnerDispatch(`runner-a`),
      sandbox: { profile: `docker`, key: `session-1` },
    })

    expect(createEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        sandbox: { profile: `docker`, key: `session-1` },
      })
    )
  })

  it(`inherits the parent's profile + key`, async () => {
    const { manager, createEntity } = buildManager({
      runners: { 'runner-a': [`local`, `docker`] },
      entities: parentWithSharedSandbox(`runner-a`),
    })

    await manager.spawn(`horton`, {
      instance_id: `child`,
      parent: `/horton/parent`,
      sandbox: { inherit: true },
    })

    // The child ATTACHES to the parent's sandbox (owner: false), never owning
    // it — so killing the child can't reclaim the parent's workspace.
    expect(createEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        sandbox: { profile: `docker`, key: `session-1`, owner: false },
      })
    )
  })

  it(`inherit is a graceful no-op when the parent has no shared sandbox`, async () => {
    const { manager, createEntity } = buildManager({
      runners: { 'runner-a': [`local`, `docker`] },
      entities: {
        '/horton/parent': {
          type: `horton`,
          status: `idle`,
          url: `/horton/parent`,
          streams: {
            main: `/horton/parent/main`,
            error: `/horton/parent/error`,
          },
          tags: {},
          dispatch_policy: runnerDispatch(`runner-a`),
          // no sandbox / no key
          created_at: 1,
          updated_at: 1,
        },
      },
    })

    // spawn_worker always requests inherit; an unkeyed parent must not break
    // the spawn — the child simply gets no sandbox.
    await manager.spawn(`horton`, {
      instance_id: `child`,
      parent: `/horton/parent`,
      sandbox: { inherit: true },
    })

    expect(createEntity).toHaveBeenCalledWith(
      expect.objectContaining({ sandbox: undefined })
    )
  })

  it(`rejects a shared LOCAL sandbox that isn't pinned to a single runner`, async () => {
    const { manager } = buildManager({
      runners: { 'runner-a': [`local`, `docker`] },
    })

    await expect(
      manager.spawn(`horton`, {
        instance_id: `t1`,
        // unpinned dispatch — collaborators could land on different hosts
        sandbox: { profile: `docker`, key: `session-1` },
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining(`pinned to a single runner`),
    })
  })

  it(`accepts a shared REMOTE sandbox without single-runner pinning`, async () => {
    const { manager, createEntity } = buildManager({
      runners: { 'runner-a': [`local`, { name: `e2b`, remote: true }] },
    })

    // Unpinned + shared key: the remote VM is reachable from any runner, so
    // the co-location guard does not apply.
    await manager.spawn(`horton`, {
      instance_id: `t1`,
      sandbox: { profile: `e2b`, key: `session-1` },
    })

    expect(createEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        sandbox: { profile: `e2b`, key: `session-1` },
      })
    )
  })

  it(`still pins a shared sandbox when a same-named profile is local on another runner`, async () => {
    const { manager } = buildManager({
      runners: {
        'runner-a': [{ name: `e2b`, remote: true }],
        // Another runner advertises the same name as host-local — a
        // collaborator could land there, so the guard must still apply.
        'runner-b': [`e2b`],
      },
    })

    await expect(
      manager.spawn(`horton`, {
        instance_id: `t1`,
        sandbox: { profile: `e2b`, key: `session-1` },
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining(`pinned to a single runner`),
    })
  })
})

describe(`EntityManager.spawn sandbox scope / persistent`, () => {
  it(`carries scope + persistent through, leaving the key unstored`, async () => {
    const { manager, createEntity } = buildManager({
      runners: { 'runner-a': [`local`, `docker`] },
    })

    await manager.spawn(`horton`, {
      instance_id: `t1`,
      dispatch_policy: runnerDispatch(`runner-a`),
      sandbox: { profile: `docker`, scope: `wake`, persistent: false },
    })

    // scope-derived keys are resolved at wake time, so no `key` is persisted —
    // which keeps the co-location guard keyed on genuine cross-entity sharing.
    expect(createEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        sandbox: { profile: `docker`, scope: `wake`, persistent: false },
      })
    )
  })

  it(`does NOT require single-runner pinning for a scoped (keyless) spawn`, async () => {
    const { manager, createEntity } = buildManager({
      runners: { 'runner-a': [`local`, `docker`] },
    })

    // Unpinned + scope (no explicit key): the guard only fires for a stored
    // cross-entity `key`, so a per-wake/per-entity scoped spawn is allowed.
    await manager.spawn(`horton`, {
      instance_id: `t1`,
      sandbox: { profile: `docker`, scope: `entity` },
    })

    expect(createEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        sandbox: { profile: `docker`, scope: `entity` },
      })
    )
  })

  it(`an explicit persistent flag is stored alongside an explicit key`, async () => {
    const { manager, createEntity } = buildManager({
      runners: { 'runner-a': [`local`, `docker`] },
    })

    await manager.spawn(`horton`, {
      instance_id: `t1`,
      dispatch_policy: runnerDispatch(`runner-a`),
      sandbox: { profile: `docker`, key: `team-room`, persistent: true },
    })

    expect(createEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        sandbox: { profile: `docker`, key: `team-room`, persistent: true },
      })
    )
  })
})

describe(`EntityManager.spawn sandbox ownership`, () => {
  it(`a direct profile spawn defaults to owner (no owner flag stored)`, async () => {
    const { manager, createEntity } = buildManager({
      runners: { 'runner-a': [`local`, `docker`] },
    })

    await manager.spawn(`horton`, {
      instance_id: `t1`,
      dispatch_policy: runnerDispatch(`runner-a`),
      sandbox: { profile: `docker` },
    })

    // Owner is the default, so it's left implicit in storage.
    expect(createEntity).toHaveBeenCalledWith(
      expect.objectContaining({ sandbox: { profile: `docker` } })
    )
  })

  it(`an explicit owner:false is stored as an attacher`, async () => {
    const { manager, createEntity } = buildManager({
      runners: { 'runner-a': [`local`, `docker`] },
    })

    await manager.spawn(`horton`, {
      instance_id: `t1`,
      dispatch_policy: runnerDispatch(`runner-a`),
      sandbox: { profile: `docker`, key: `team-room`, owner: false },
    })

    expect(createEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        sandbox: { profile: `docker`, key: `team-room`, owner: false },
      })
    )
  })
})
