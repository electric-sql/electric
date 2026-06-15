import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityPermissionGrant } from './entityGrants'

const mocks = vi.hoisted(() => ({
  serverFetch: vi.fn(),
}))

vi.mock(`@electric-ax/agents-server-ui/src/lib/auth-fetch`, () => ({
  serverFetch: mocks.serverFetch,
}))

function grant(
  id: number,
  permission: string,
  subject: Partial<EntityPermissionGrant> = {}
): EntityPermissionGrant {
  return {
    id,
    entity_url: `/horton/abc`,
    permission,
    subject_kind: `principal`,
    subject_value: `/principal/user%3Aalice`,
    created_at: `2026-01-01`,
    updated_at: `2026-01-01`,
    ...subject,
  }
}

function allUsersGrant(id: number, permission: string): EntityPermissionGrant {
  return grant(id, permission, {
    subject_kind: `principal_kind`,
    subject_value: `user`,
  })
}

describe(`diffGrantsForRole`, () => {
  it(`creates the missing permissions when upgrading view to chat`, async () => {
    const { diffGrantsForRole } = await import(`./entityGrants`)
    const existing = [grant(1, `read`), grant(2, `fork`)]
    expect(diffGrantsForRole(existing, `chat`)).toEqual({
      deleteIds: [],
      createPermissions: [`write`, `signal`, `schedule`, `spawn`],
    })
  })

  it(`deletes the extra grants when downgrading chat to view`, async () => {
    const { diffGrantsForRole } = await import(`./entityGrants`)
    const existing = [
      grant(1, `read`),
      grant(2, `write`),
      grant(3, `signal`),
      grant(4, `fork`),
      grant(5, `schedule`),
      grant(6, `spawn`),
    ]
    expect(diffGrantsForRole(existing, `view`)).toEqual({
      deleteIds: [2, 3, 5, 6],
      createPermissions: [],
    })
  })

  it(`swaps the full permission set between disjoint roles`, async () => {
    const { diffGrantsForRole } = await import(`./entityGrants`)
    const existing = [grant(1, `manage`), grant(2, `delete`)]
    expect(diffGrantsForRole(existing, `chat`)).toEqual({
      deleteIds: [1, 2],
      createPermissions: [
        `read`,
        `write`,
        `signal`,
        `fork`,
        `schedule`,
        `spawn`,
      ],
    })
  })

  it(`keeps duplicate rows for retained permissions and deletes all copies of dropped ones`, async () => {
    const { diffGrantsForRole } = await import(`./entityGrants`)
    const existing = [
      grant(1, `read`),
      grant(2, `read`),
      grant(3, `write`),
      grant(4, `write`),
    ]
    expect(diffGrantsForRole(existing, `view`)).toEqual({
      deleteIds: [3, 4],
      createPermissions: [`fork`],
    })
  })

  it(`never touches non-share custom permissions`, async () => {
    const { diffGrantsForRole } = await import(`./entityGrants`)
    const existing = [grant(1, `read`), grant(2, `custom:observe`)]
    expect(diffGrantsForRole(existing, `view`).deleteIds).toEqual([])
  })
})

describe(`grantIdsForRemoval`, () => {
  it(`returns every share-permission grant id and skips custom permissions`, async () => {
    const { grantIdsForRemoval } = await import(`./entityGrants`)
    const existing = [
      grant(1, `read`),
      grant(2, `manage`),
      grant(3, `custom:observe`),
    ]
    expect(grantIdsForRemoval(existing)).toEqual([1, 2])
  })
})

describe(`buildShareAccessModel`, () => {
  it(`groups user grants and derives their role`, async () => {
    const { buildShareAccessModel } = await import(`./entityGrants`)
    const model = buildShareAccessModel(
      [grant(1, `read`), grant(2, `fork`)],
      null
    )
    expect(model.allUsers).toBeNull()
    expect(model.users).toEqual([
      {
        userId: `alice`,
        role: `view`,
        grants: [grant(1, `read`), grant(2, `fork`)],
      },
    ])
  })

  it(`surfaces an all-users entry separately from individual users`, async () => {
    const { buildShareAccessModel } = await import(`./entityGrants`)
    const model = buildShareAccessModel(
      [
        allUsersGrant(1, `manage`),
        allUsersGrant(2, `delete`),
        grant(3, `read`),
      ],
      null
    )
    expect(model.allUsers).toEqual({
      role: `manage`,
      grants: [allUsersGrant(1, `manage`), allUsersGrant(2, `delete`)],
    })
    expect(model.users.map((entry) => entry.userId)).toEqual([`alice`])
  })

  it(`drops the current user, non-user principals and role-less subjects`, async () => {
    const { buildShareAccessModel } = await import(`./entityGrants`)
    const model = buildShareAccessModel(
      [
        grant(1, `read`),
        grant(2, `read`, { subject_value: `/principal/system%3Aframework` }),
        grant(3, `fork`, { subject_value: `/principal/user%3Abob` }),
      ],
      `alice`
    )
    // bob's only grant is `fork`, which maps to no role; alice is the
    // current user; the system principal is not a user.
    expect(model.users).toEqual([])
  })

  it(`exposes raw grants for role-less users so re-adding diffs against them`, async () => {
    const { buildShareAccessModel } = await import(`./entityGrants`)
    const forkOnly = grant(1, `fork`, {
      subject_value: `/principal/user%3Abob`,
    })
    const model = buildShareAccessModel([forkOnly], null)
    expect(model.users).toEqual([])
    expect(model.grantsByUserId.get(`bob`)).toEqual([forkOnly])
  })
})

describe(`grant requests`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it(`lists grants from the manage-protected entity endpoint`, async () => {
    const { listEntityGrants } = await import(`./entityGrants`)
    mocks.serverFetch.mockResolvedValue(
      new Response(JSON.stringify({ grants: [grant(1, `read`)] }), {
        status: 200,
      })
    )
    const grants = await listEntityGrants({
      baseUrl: `http://server`,
      entityUrl: `/horton/abc`,
    })
    expect(mocks.serverFetch).toHaveBeenCalledWith(
      `http://server/_electric/entities/horton/abc/grants`
    )
    expect(grants).toEqual([grant(1, `read`)])
  })

  it(`creates a grant with the bare subject/permission body`, async () => {
    const { createEntityGrant } = await import(`./entityGrants`)
    mocks.serverFetch.mockResolvedValue(new Response(`{}`, { status: 201 }))
    await createEntityGrant({
      baseUrl: `http://server`,
      entityUrl: `/horton/abc`,
      subject: { kind: `principal`, value: `/principal/user%3Abob` },
      permission: `read`,
    })
    const [url, init] = mocks.serverFetch.mock.calls.at(-1)!
    expect(url).toBe(`http://server/_electric/entities/horton/abc/grants`)
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      subject_kind: `principal`,
      subject_value: `/principal/user%3Abob`,
      permission: `read`,
    })
  })

  it(`deletes a grant by id`, async () => {
    const { deleteEntityGrant } = await import(`./entityGrants`)
    mocks.serverFetch.mockResolvedValue(new Response(null, { status: 204 }))
    await deleteEntityGrant({
      baseUrl: `http://server`,
      entityUrl: `/horton/abc`,
      grantId: 7,
    })
    const [url, init] = mocks.serverFetch.mock.calls.at(-1)!
    expect(url).toBe(`http://server/_electric/entities/horton/abc/grants/7`)
    expect((init as RequestInit).method).toBe(`DELETE`)
  })

  it(`throws a GrantsRequestError carrying the status and server message`, async () => {
    const { GrantsRequestError, listEntityGrants } = await import(
      `./entityGrants`
    )
    mocks.serverFetch.mockResolvedValue(
      new Response(JSON.stringify({ message: `manage required` }), {
        status: 401,
      })
    )
    const error = await listEntityGrants({
      baseUrl: `http://server`,
      entityUrl: `/horton/abc`,
    }).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(GrantsRequestError)
    expect((error as InstanceType<typeof GrantsRequestError>).status).toBe(401)
    expect((error as Error).message).toBe(`manage required`)
  })
})

describe(`setSubjectRole`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.serverFetch.mockResolvedValue(new Response(`{}`, { status: 200 }))
  })

  it(`fans out the diff as parallel delete and create requests`, async () => {
    const { setSubjectRole } = await import(`./entityGrants`)
    await setSubjectRole({
      baseUrl: `http://server`,
      entityUrl: `/horton/abc`,
      subject: { kind: `principal`, value: `/principal/user%3Aalice` },
      role: `view`,
      existingGrants: [grant(1, `read`), grant(2, `write`)],
    })
    const calls = mocks.serverFetch.mock.calls.map(([url, init]) => [
      url,
      (init as RequestInit | undefined)?.method ?? `GET`,
    ])
    expect(calls).toContainEqual([
      `http://server/_electric/entities/horton/abc/grants/2`,
      `DELETE`,
    ])
    expect(calls).toContainEqual([
      `http://server/_electric/entities/horton/abc/grants`,
      `POST`,
    ])
  })

  it(`is a no-op when the grants already match the role`, async () => {
    const { setSubjectRole } = await import(`./entityGrants`)
    await setSubjectRole({
      baseUrl: `http://server`,
      entityUrl: `/horton/abc`,
      subject: { kind: `principal`, value: `/principal/user%3Aalice` },
      role: `view`,
      existingGrants: [grant(1, `read`), grant(2, `fork`)],
    })
    expect(mocks.serverFetch).not.toHaveBeenCalled()
  })
})
