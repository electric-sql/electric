import { describe, expect, it } from 'vitest'
import {
  mergeAvailableServers,
  resolveActiveAfterCloudSignOut,
} from './availableServers'
import type { CloudAgentServer } from './cloudAgentServers'
import type { SavedServer } from './savedServers'

const resolveCloudUrl = (id: string) =>
  `https://agents.electric-sql.cloud/t/${id}/v1`

const cloudServer = (
  id: string,
  name: string,
  extra: Partial<CloudAgentServer> = {}
): CloudAgentServer => ({
  id,
  name,
  workspaceId: `w`,
  workspaceName: `Acme`,
  projectId: `p`,
  projectName: `Web`,
  environmentId: `e`,
  environmentName: `prod`,
  updatedAt: null,
  ...extra,
})

const savedManual: SavedServer = {
  id: `https://self.example/v1`,
  name: `self.example`,
  url: `https://self.example/v1`,
  source: `manual`,
}

describe(`mergeAvailableServers`, () => {
  it(`appends live cloud servers after saved ones`, () => {
    const result = mergeAvailableServers(
      [savedManual],
      [cloudServer(`svc-1`, `Prod`)],
      null,
      resolveCloudUrl
    )
    expect(result.map((s) => s.key)).toEqual([
      `saved:https://self.example/v1`,
      `cloud:svc-1`,
    ])
    expect(result[0]).toMatchObject({ kind: `self-hosted`, saved: true })
    expect(result[1]).toMatchObject({
      kind: `cloud`,
      saved: false,
      url: `https://agents.electric-sql.cloud/t/svc-1/v1`,
      breadcrumb: `Acme · Web · prod`,
    })
  })

  it(`does not duplicate a cloud server already saved (dedup by service id)`, () => {
    const savedCloud: SavedServer = {
      id: `svc-1`,
      name: `Prod`,
      url: `https://agents.electric-sql.cloud/t/svc-1/v1`,
      source: `electric-cloud`,
    }
    const result = mergeAvailableServers(
      [savedCloud],
      [cloudServer(`svc-1`, `Prod`), cloudServer(`svc-2`, `Staging`)],
      null,
      resolveCloudUrl
    )
    expect(result.map((s) => s.key)).toEqual([`saved:svc-1`, `cloud:svc-2`])
    // The saved cloud entry is enriched with the live breadcrumb.
    expect(result[0]).toMatchObject({
      saved: true,
      kind: `cloud`,
      breadcrumb: `Acme · Web · prod`,
    })
  })

  it(`marks the entry matching the active URL`, () => {
    const result = mergeAvailableServers(
      [savedManual],
      [cloudServer(`svc-1`, `Prod`)],
      `https://agents.electric-sql.cloud/t/svc-1/v1`,
      resolveCloudUrl
    )
    expect(result.find((s) => s.isActive)?.key).toBe(`cloud:svc-1`)
    expect(result.filter((s) => s.isActive)).toHaveLength(1)
  })
})

describe(`resolveActiveAfterCloudSignOut`, () => {
  const cloudUrl = `https://agents.electric-sql.cloud/t/svc-1/v1`

  it(`leaves a self-hosted active server untouched`, () => {
    expect(
      resolveActiveAfterCloudSignOut(`https://self.example/v1`, [savedManual])
    ).toEqual({ changed: false, url: `https://self.example/v1` })
  })

  it(`leaves a null active server untouched`, () => {
    expect(resolveActiveAfterCloudSignOut(null, [])).toEqual({
      changed: false,
      url: null,
    })
  })

  it(`falls back to a remaining self-hosted server when active was cloud`, () => {
    expect(resolveActiveAfterCloudSignOut(cloudUrl, [savedManual])).toEqual({
      changed: true,
      url: `https://self.example/v1`,
    })
  })

  it(`clears the active server when no self-hosted server remains`, () => {
    expect(resolveActiveAfterCloudSignOut(cloudUrl, [])).toEqual({
      changed: true,
      url: null,
    })
  })
})
