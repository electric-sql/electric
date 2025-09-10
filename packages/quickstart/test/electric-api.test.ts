import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  provisionElectricResources,
  claimResources,
  type ElectricCredentials,
} from '../src/electric-api.js'

// Mock node-fetch
vi.mock(`node-fetch`, () => ({
  default: vi.fn(),
}))

describe(`electric-api`, () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    mockFetch = (await vi.importMock(`node-fetch`)).default
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe(`provisionElectricResources`, () => {
    it(`should successfully provision resources`, async () => {
      const mockCredentials: ElectricCredentials = {
        source_id: `test-source-id`,
        secret: `test-secret`,
        DATABASE_URL: `postgresql://test:test@localhost:5432/test`,
      }

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockCredentials),
        status: 200,
        statusText: `OK`,
      })

      const result = await provisionElectricResources()

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.electric-sql.com/v1/provision`,
        {
          method: `POST`,
          headers: {
            'Content-Type': `application/json`,
            'User-Agent': `@electric-sql/quickstart`,
          },
          body: JSON.stringify({
            type: `starter`,
            template: `tanstack-start`,
          }),
        }
      )

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

    it(`should handle missing credentials in response`, async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ source_id: `test` }), // Missing secret and DATABASE_URL
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

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.electric-sql.com/v1/claim`,
        {
          method: `POST`,
          headers: {
            'Content-Type': `application/json`,
            Authorization: `Bearer ${testSecret}`,
            'User-Agent': `@electric-sql/quickstart`,
          },
          body: JSON.stringify({
            source_id: testSourceId,
          }),
        }
      )

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
