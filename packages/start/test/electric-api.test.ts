import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  provisionElectricResources,
  claimResources,
  type ElectricCredentials,
} from '../src/electric-api.js'

describe(`electric-api`, () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal(`fetch`, mockFetch)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetAllMocks()
  })

  // Helper to extract path from URL for assertions
  function getUrlPath(url: string | URL | Request): string {
    const urlString = url instanceof Request ? url.url : url.toString()
    return new URL(urlString).pathname
  }

  describe(`provisionElectricResources`, () => {
    it(`should successfully provision resources`, async () => {
      const testClaimId = `test-claim-id`
      const mockCredentials: ElectricCredentials = {
        source_id: `test-source-id`,
        secret: `test-secret`,
        DATABASE_URL: `postgresql://test:test@localhost:5432/test`,
      }

      // Mock the two-step process: POST to create, then GET to poll
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ claimId: testClaimId }),
          status: 200,
          statusText: `OK`,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              state: `ready`,
              source: {
                source_id: mockCredentials.source_id,
                secret: mockCredentials.secret,
              },
              connection_uri: mockCredentials.DATABASE_URL,
            }),
          status: 200,
          statusText: `OK`,
        })

      const result = await provisionElectricResources()

      // Verify first call (POST to create claimable source)
      expect(mockFetch).toHaveBeenCalledTimes(2)
      const firstCall = mockFetch.mock.calls[0]
      expect(getUrlPath(firstCall[0])).toMatch(
        /\/public\/v1\/claimable-sources$/
      )
      expect(firstCall[1]).toEqual({
        method: `POST`,
        headers: {
          'Content-Type': `application/json`,
          'User-Agent': `@electric-sql/start`,
        },
        body: JSON.stringify({}),
      })

      // Verify second call (GET to poll status)
      const secondCall = mockFetch.mock.calls[1]
      expect(getUrlPath(secondCall[0])).toMatch(
        new RegExp(`/public/v1/claimable-sources/${testClaimId}$`)
      )
      expect(secondCall[1]).toEqual({
        method: `GET`,
        headers: {
          'User-Agent': `@electric-sql/start`,
        },
      })

      expect(result).toEqual(mockCredentials)
    })

    it(`should handle API errors`, async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: `Internal Server Error`,
      })

      await expect(provisionElectricResources()).rejects.toThrow(
        `Failed to provision Electric resources: Electric API error: 500 Internal Server Error`
      )
    })

    it(`should handle missing claimId in response`, async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}), // Missing claimId
        status: 200,
        statusText: `OK`,
      })

      await expect(provisionElectricResources()).rejects.toThrow(
        `Failed to provision Electric resources: Invalid response from Electric API - missing claimId`
      )
    })

    it(`should handle missing credentials in ready response`, async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ claimId: `test-claim-id` }),
          status: 200,
          statusText: `OK`,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              state: `ready`,
              source: { source_id: `test` }, // Missing secret
              // Missing connection_uri
            }),
          status: 200,
          statusText: `OK`,
        })

      await expect(provisionElectricResources()).rejects.toThrow(
        `Failed to provision Electric resources: Invalid response from Electric API - missing required credentials`
      )
    })

    it(`should handle network errors`, async () => {
      mockFetch.mockRejectedValue(new Error(`Network error`))

      await expect(provisionElectricResources()).rejects.toThrow(
        `Failed to provision Electric resources: Network error`
      )
    })

    it(`should handle unknown errors`, async () => {
      mockFetch.mockRejectedValue(`Unknown error`)

      await expect(provisionElectricResources()).rejects.toThrow(
        `Failed to provision Electric resources: Unknown error`
      )
    })

    it(`should poll until ready state`, async () => {
      const testClaimId = `test-claim-id`
      const mockCredentials: ElectricCredentials = {
        source_id: `test-source-id`,
        secret: `test-secret`,
        DATABASE_URL: `postgresql://test:test@localhost:5432/test`,
      }

      mockFetch
        // Initial POST
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ claimId: testClaimId }),
          status: 200,
          statusText: `OK`,
        })
        // First poll - pending
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ state: `pending` }),
          status: 200,
          statusText: `OK`,
        })
        // Second poll - ready
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              state: `ready`,
              source: {
                source_id: mockCredentials.source_id,
                secret: mockCredentials.secret,
              },
              connection_uri: mockCredentials.DATABASE_URL,
            }),
          status: 200,
          statusText: `OK`,
        })

      const result = await provisionElectricResources()

      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(result).toEqual(mockCredentials)
    })

    it(`should handle failed provisioning state`, async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ claimId: `test-claim-id` }),
          status: 200,
          statusText: `OK`,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              state: `failed`,
              error: `Database provisioning failed`,
            }),
          status: 200,
          statusText: `OK`,
        })

      await expect(provisionElectricResources()).rejects.toThrow(
        `Failed to provision Electric resources: Resource provisioning failed: Database provisioning failed`
      )
    })
  })

  describe(`claimResources`, () => {
    const testSourceId = `test-source-id`
    const testSecret = `test-secret`

    it(`should successfully claim resources`, async () => {
      const mockClaimResponse = {
        claimUrl: `https://electric-sql.com/claim/test-claim-url`,
      }

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockClaimResponse),
        status: 200,
        statusText: `OK`,
      })

      const result = await claimResources(testSourceId, testSecret)

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const call = mockFetch.mock.calls[0]
      expect(getUrlPath(call[0])).toMatch(/\/v1\/claim$/)
      expect(call[1]).toEqual({
        method: `POST`,
        headers: {
          'Content-Type': `application/json`,
          Authorization: `Bearer ${testSecret}`,
          'User-Agent': `@electric-sql/start`,
        },
        body: JSON.stringify({
          source_id: testSourceId,
        }),
      })

      expect(result).toEqual(mockClaimResponse)
    })

    it(`should handle API errors during claim`, async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: `Unauthorized`,
      })

      await expect(claimResources(testSourceId, testSecret)).rejects.toThrow(
        `Failed to initiate resource claim: Electric API error: 401 Unauthorized`
      )
    })

    it(`should handle missing claim URL in response`, async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}), // Missing claimUrl
        status: 200,
        statusText: `OK`,
      })

      await expect(claimResources(testSourceId, testSecret)).rejects.toThrow(
        `Failed to initiate resource claim: Invalid response from Electric API - missing claim URL`
      )
    })

    it(`should handle network errors during claim`, async () => {
      mockFetch.mockRejectedValue(new Error(`Connection timeout`))

      await expect(claimResources(testSourceId, testSecret)).rejects.toThrow(
        `Failed to initiate resource claim: Connection timeout`
      )
    })

    it(`should handle unknown errors during claim`, async () => {
      mockFetch.mockRejectedValue(`Unknown claim error`)

      await expect(claimResources(testSourceId, testSecret)).rejects.toThrow(
        `Failed to initiate resource claim: Unknown error`
      )
    })
  })
})
