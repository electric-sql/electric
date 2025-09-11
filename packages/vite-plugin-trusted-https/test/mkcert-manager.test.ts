import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { existsSync, readFileSync } from "fs"
import { execSync } from "child_process"
import { MkcertManager } from "../src/mkcert-manager"
import { createTempCertDir } from "./test-utils"

// Mock dependencies for unit tests
vi.mock(`fs`)
vi.mock(`child_process`)

const mockExistsSync = vi.mocked(existsSync)
const mockReadFileSync = vi.mocked(readFileSync)
const mockExecSync = vi.mocked(execSync)

describe(`MkcertManager`, () => {
  let testCertDir: string
  let manager: MkcertManager

  beforeEach(() => {
    testCertDir = createTempCertDir()
    manager = new MkcertManager(testCertDir, [`localhost`], `test-cert`)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe(`isAvailable`, () => {
    it(`should return true when mkcert command is available`, () => {
      mockExecSync.mockReturnValueOnce(`v1.4.4`)

      const result = manager.isAvailable()

      expect(result).toBe(true)
      expect(mockExecSync).toHaveBeenCalledWith(`mkcert -version`, {
        stdio: `pipe`,
        timeout: 5000,
      })
    })

    it(`should return false when mkcert command fails`, () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error(`Command not found`)
      })

      const result = manager.isAvailable()

      expect(result).toBe(false)
    })

    it(`should return false when mkcert command times out`, () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error(`Command timeout`)
      })

      const result = manager.isAvailable()

      expect(result).toBe(false)
    })
  })

  describe(`isCAInstalled`, () => {
    it(`should return true when CA files exist`, () => {
      mockExecSync.mockReturnValueOnce(`/home/user/.local/share/mkcert`)
      mockExistsSync.mockReturnValueOnce(true) // rootCA.pem
      mockExistsSync.mockReturnValueOnce(true) // rootCA-key.pem

      const result = manager.isCAInstalled()

      expect(result).toBe(true)
      expect(mockExecSync).toHaveBeenCalledWith(`mkcert -CAROOT`, {
        stdio: `pipe`,
        encoding: `utf8`,
        timeout: 5000,
      })
    })

    it(`should return false when CAROOT command fails`, () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error(`Command failed`)
      })

      const result = manager.isCAInstalled()

      expect(result).toBe(false)
    })

    it(`should return false when CA files don't exist`, () => {
      mockExecSync.mockReturnValueOnce(`/home/user/.local/share/mkcert`)
      mockExistsSync.mockReturnValueOnce(false) // rootCA.pem missing

      const result = manager.isCAInstalled()

      expect(result).toBe(false)
    })

    it(`should return false when only one CA file exists`, () => {
      mockExecSync.mockReturnValueOnce(`/home/user/.local/share/mkcert`)
      mockExistsSync.mockReturnValueOnce(true) // rootCA.pem exists
      mockExistsSync.mockReturnValueOnce(false) // rootCA-key.pem missing

      const result = manager.isCAInstalled()

      expect(result).toBe(false)
    })
  })

  describe(`generateCertificates`, () => {
    it(`should return error if mkcert is not available`, async () => {
      // Mock isAvailable to return false
      vi.spyOn(manager, `isAvailable`).mockReturnValue(false)

      const result = await manager.generateCertificates()

      expect(result).toEqual({
        success: false,
        error: `mkcert not available`,
      })
    })

    it(`should return error if CA is not installed`, async () => {
      // Mock isAvailable to return true, but isCAInstalled to return false
      vi.spyOn(manager, `isAvailable`).mockReturnValue(true)
      vi.spyOn(manager, `isCAInstalled`).mockReturnValue(false)

      const result = await manager.generateCertificates()

      expect(result).toEqual({
        success: false,
        error: `mkcert CA not installed (run 'mkcert -install' first)`,
      })
    })

    it(`should successfully generate certificates`, async () => {
      // Mock both methods to return true
      vi.spyOn(manager, `isAvailable`).mockReturnValue(true)
      vi.spyOn(manager, `isCAInstalled`).mockReturnValue(true)

      // Mock successful certificate generation
      mockExecSync.mockReturnValueOnce(``) // mkcert generation command
      mockExistsSync
        .mockReturnValueOnce(true) // generated cert file
        .mockReturnValueOnce(true) // generated key file
      mockReadFileSync
        .mockReturnValueOnce(`mock cert content`) // cert file
        .mockReturnValueOnce(`mock key content`) // key file

      const result = await manager.generateCertificates()

      expect(result.success).toBe(true)
      expect(result.certPath).toContain(`test-cert.crt`)
      expect(result.keyPath).toContain(`test-cert.key`)
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining(`cd "` + testCertDir + `" && mkcert`),
        { stdio: `pipe`, timeout: 30000 }
      )
    })

    it(`should handle mkcert command failure`, async () => {
      // Mock both methods to return true
      vi.spyOn(manager, `isAvailable`).mockReturnValue(true)
      vi.spyOn(manager, `isCAInstalled`).mockReturnValue(true)

      // Mock mkcert command failure
      mockExecSync.mockImplementationOnce(() => {
        throw new Error(`mkcert generation failed`)
      })

      const result = await manager.generateCertificates()

      expect(result).toEqual({
        success: false,
        error: `mkcert generation failed`,
      })
    })

    it(`should handle missing generated files`, async () => {
      // Mock both methods to return true
      vi.spyOn(manager, `isAvailable`).mockReturnValue(true)
      vi.spyOn(manager, `isCAInstalled`).mockReturnValue(true)

      mockExecSync.mockReturnValueOnce(``) // mkcert command succeeds
      mockExistsSync
        .mockReturnValueOnce(false) // generated cert file missing
        .mockReturnValueOnce(true) // generated key file exists

      const result = await manager.generateCertificates()

      expect(result).toEqual({
        success: false,
        error: `mkcert did not generate expected certificate files`,
      })
    })

    it(`should handle unreadable generated files`, async () => {
      // Mock both methods to return true
      vi.spyOn(manager, `isAvailable`).mockReturnValue(true)
      vi.spyOn(manager, `isCAInstalled`).mockReturnValue(true)

      mockExecSync.mockReturnValueOnce(``) // mkcert command succeeds
      mockExistsSync
        .mockReturnValueOnce(true) // cert file exists
        .mockReturnValueOnce(true) // key file exists
      mockReadFileSync.mockImplementationOnce(() => {
        throw new Error(`File read error`)
      })

      const result = await manager.generateCertificates()

      expect(result).toEqual({
        success: false,
        error: `Generated certificate files are not readable`,
      })
    })

    it(`should generate certificates for multiple domains`, async () => {
      const multiDomainManager = new MkcertManager(
        testCertDir,
        [`localhost`, `*.localhost`, `127.0.0.1`],
        `multi-domain-cert`
      )

      // Mock both methods to return true
      vi.spyOn(multiDomainManager, `isAvailable`).mockReturnValue(true)
      vi.spyOn(multiDomainManager, `isCAInstalled`).mockReturnValue(true)

      mockExecSync.mockReturnValueOnce(``) // mkcert generation
      mockExistsSync
        .mockReturnValueOnce(true) // cert file
        .mockReturnValueOnce(true) // key file
      mockReadFileSync
        .mockReturnValueOnce(`mock cert content`)
        .mockReturnValueOnce(`mock key content`)

      const result = await multiDomainManager.generateCertificates()

      expect(result.success).toBe(true)
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining(`localhost *.localhost 127.0.0.1`),
        expect.any(Object)
      )
    })
  })

  describe(`getSetupInstructions`, () => {
    it(`should return macOS instructions`, () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, `platform`, { value: `darwin` })

      const instructions = manager.getSetupInstructions()

      expect(instructions).toContain(`brew install mkcert`)
      expect(instructions).toContain(`mkcert -install`)

      Object.defineProperty(process, `platform`, { value: originalPlatform })
    })

    it(`should return Linux instructions`, () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, `platform`, { value: `linux` })

      const instructions = manager.getSetupInstructions()

      expect(instructions).toContain(`apt install mkcert`)
      expect(instructions).toContain(`mkcert -install`)

      Object.defineProperty(process, `platform`, { value: originalPlatform })
    })

    it(`should return generic instructions for other platforms`, () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, `platform`, { value: `win32` })

      const instructions = manager.getSetupInstructions()

      expect(instructions).toContain(`https://github.com/FiloSottile/mkcert`)
      expect(instructions).toContain(`mkcert -install`)

      Object.defineProperty(process, `platform`, { value: originalPlatform })
    })
  })
})
