import { describe, it, expect, vi, beforeEach } from "vitest"
import { TrustInstaller } from "../src/trust-installer"
import { execSync } from "child_process"
import { existsSync } from "fs"

// Mock child_process and fs
vi.mock(`child_process`)
vi.mock(`fs`)

const mockExecSync = vi.mocked(execSync)
const mockExistsSync = vi.mocked(existsSync)

describe(`TrustInstaller`, () => {
  let installer: TrustInstaller

  beforeEach(() => {
    installer = new TrustInstaller(`Test Cert`)
    vi.clearAllMocks()
    // Default to certificate exists
    mockExistsSync.mockReturnValue(true)
  })

  describe(`install`, () => {
    it(`should return error if certificate file doesn't exist`, async () => {
      mockExistsSync.mockReturnValue(false)

      const result = await installer.install(`/nonexistent/cert.crt`)

      expect(result.success).toBe(false)
      expect(result.error).toContain(`Certificate file not found`)
    })

    it(`should successfully install on macOS`, async () => {
      // Mock process.platform
      const originalPlatform = process.platform
      Object.defineProperty(process, `platform`, { value: `darwin` })

      mockExecSync.mockReturnValue(Buffer.from(`success`))

      const result = await installer.install(`/test/cert.crt`)

      expect(result.success).toBe(true)
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining(`security add-trusted-cert`),
        expect.any(Object)
      )

      // Restore platform
      Object.defineProperty(process, `platform`, { value: originalPlatform })
    })
  })

  describe(`checkTrusted`, () => {
    it(`should return false if certificate file doesn't exist`, async () => {
      mockExistsSync.mockReturnValue(false)

      const result = await installer.checkTrusted(`/nonexistent/cert.crt`)

      expect(result).toBe(false)
    })

    it(`should check trust status on macOS`, async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, `platform`, { value: `darwin` })

      mockExecSync.mockReturnValue(
        Buffer.from(`certificate verification successful`)
      )

      const result = await installer.checkTrusted(`/test/cert.crt`)

      expect(result).toBe(true)
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining(`security verify-cert`),
        expect.any(Object)
      )

      Object.defineProperty(process, `platform`, { value: originalPlatform })
    })
  })
})
