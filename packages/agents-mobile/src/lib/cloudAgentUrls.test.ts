import { describe, expect, it } from 'vitest'
import {
  cloudAgentServerUrlFromDashboard,
  getCloudServiceIdFromServerUrl,
} from './cloudAgentUrls'

describe(`cloud agent server URLs`, () => {
  it(`derives tenant-scoped agents URLs from dashboard URLs`, () => {
    expect(
      cloudAgentServerUrlFromDashboard(
        `https://dashboard.electric-sql.cloud`,
        `svc-123`
      )
    ).toBe(`https://agents.electric-sql.cloud/t/svc-123/v1`)

    expect(
      cloudAgentServerUrlFromDashboard(
        `https://dashboard.staging.example/base/?ignored=1#hash`,
        `svc/spaced id`
      )
    ).toBe(`https://agents.staging.example/base/t/svc%2Fspaced%20id/v1`)
  })

  it(`extracts service ids from tenant-scoped base URLs`, () => {
    expect(
      getCloudServiceIdFromServerUrl(
        `https://agents.electric-sql.cloud/t/svc-123/v1`
      )
    ).toBe(`svc-123`)

    expect(
      getCloudServiceIdFromServerUrl(
        `https://agents.example/base/t/svc%2Fencoded/v1/_electric/health`
      )
    ).toBe(`svc/encoded`)
  })

  it(`does not treat deprecated query-routed URLs as Cloud agent URLs`, () => {
    expect(
      getCloudServiceIdFromServerUrl(
        `https://agents.electric-sql.cloud/?service=svc-123`
      )
    ).toBeNull()
  })
})
