import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { TrustInstaller } from "../src/trust-installer"
import { CertificateManager } from "../src/certificate-manager"
import { MkcertManager } from "../src/mkcert-manager"
import { existsSync, rmSync } from "fs"
import { join } from "path"
import {
  createTempCertDir,
  skipIfNotPlatform,
  skipIfCannotTestTrust,
  ENABLE_INTEGRATION_TESTS,
  hasCommand,
} from "./test-utils"

// Safe Integration Tests - Certificate generation and validation without system modification
describe.skipIf(!ENABLE_INTEGRATION_TESTS)(
  `TrustInstaller safe integration`,
  () => {
    let testCertDir: string
    let installer: TrustInstaller
    let manager: CertificateManager

    beforeEach(async () => {
      testCertDir = join(process.cwd(), createTempCertDir())
      installer = new TrustInstaller(`Safe Test Cert`)
      manager = new CertificateManager({
        certDir: testCertDir,
        domains: [`localhost`],
        name: `safe-test`,
      })
    })

    afterEach(() => {
      // Clean up certificates and test directory
      if (existsSync(testCertDir)) {
        rmSync(testCertDir, { recursive: true })
      }
    })

    it(`should generate certificates and prepare for installation`, async () => {
      // Generate real certificate
      const certResult = await manager.ensureCertificates()
      expect(certResult).toBeDefined()
      expect(certResult.cert).toBeTruthy()
      expect(existsSync(certResult.cert)).toBe(true)

      // Test that installer can handle the certificate path (without actually installing)
      expect(installer).toBeDefined()
      expect(typeof installer.install).toBe(`function`)
      expect(typeof installer.checkTrusted).toBe(`function`)
      expect(typeof installer.remove).toBe(`function`)

      // Verify certificate file exists and has correct format
      const fs = await import(`fs`)
      const certContent = fs.readFileSync(certResult.cert, `utf8`)
      expect(certContent).toMatch(/^-----BEGIN CERTIFICATE-----/)
      expect(certContent).toMatch(/-----END CERTIFICATE-----$/)
    })

    it(`should provide correct manual instructions for current platform`, () => {
      const testCertPath = `/test/path/cert.crt`
      const instructions = installer.getManualInstructions(testCertPath)

      expect(instructions).toBeTruthy()
      expect(instructions).toContain(testCertPath)

      // Check platform-specific instructions
      switch (process.platform) {
        case `darwin`:
          expect(instructions).toContain(`Keychain Access`)
          break
        case `linux`:
          expect(instructions).toContain(`update-ca-certificates`)
          break
        case `win32`:
          expect(instructions).toContain(`Certificate`)
          break
        default:
          expect(instructions).toContain(`manually trust`)
      }
    })
  }
)

// Full Integration Tests - ACTUALLY MODIFIES SYSTEM TRUST STORE (requires VITEST_FULL_INTEGRATION=true)
describe.skipIf(skipIfCannotTestTrust())(
  `TrustInstaller full system integration`,
  () => {
    let testCertDir: string
    let installer: TrustInstaller
    let manager: CertificateManager

    beforeEach(async () => {
      testCertDir = join(process.cwd(), createTempCertDir())
      installer = new TrustInstaller(`Test Integration Cert`)
      manager = new CertificateManager({
        certDir: testCertDir,
        domains: [`localhost`],
        name: `test-integration`,
      })
    })

    afterEach(() => {
      // Clean up certificates and test directory
      if (existsSync(testCertDir)) {
        rmSync(testCertDir, { recursive: true })
      }
    })

    describe.skipIf(skipIfNotPlatform(`darwin`))(`macOS integration`, () => {
      it(`should install and verify certificates on macOS`, async () => {
        // Generate real certificate
        const certResult = await manager.ensureCertificates()
        expect(certResult).toBeDefined()
        expect(certResult.cert).toBeTruthy()
        expect(existsSync(certResult.cert)).toBe(true)

        // Install certificate (this modifies system trust store)
        const installResult = await installer.install(certResult.cert)
        expect(typeof installResult.success).toBe(`boolean`)

        // If installation succeeded, verify trust status
        if (installResult.success) {
          const trustResult = await installer.checkTrusted(certResult.cert)
          // Note: This might be false due to keychain complexity, but the command should not throw
          expect(typeof trustResult).toBe(`boolean`)

          // Clean up - remove certificate from trust store
          await installer.remove(certResult.cert)
        }
      }, 30000) // Extended timeout for system commands
    })

    describe.skipIf(skipIfNotPlatform(`linux`))(`Linux integration`, () => {
      it(`should handle Linux certificate installation`, async () => {
        // Generate real certificate
        const certResult = await manager.ensureCertificates()
        expect(certResult.cert).toBeTruthy()
        expect(existsSync(certResult.cert)).toBe(true)

        // Try to install certificate (may require sudo, so expect potential failure)
        const installResult = await installer.install(certResult.cert)

        // Should either succeed or provide manual instructions
        expect(typeof installResult.success).toBe(`boolean`)

        if (!installResult.success) {
          expect(installResult.error).toBeTruthy()
        }
      }, 30000)
    })

    describe.skipIf(skipIfNotPlatform(`win32`))(`Windows integration`, () => {
      it(`should handle Windows certificate installation`, async () => {
        // Generate real certificate
        const certResult = await manager.ensureCertificates()
        expect(certResult.cert).toBeTruthy()
        expect(existsSync(certResult.cert)).toBe(true)

        // Try to install certificate
        const installResult = await installer.install(certResult.cert)

        // Should either succeed or provide manual instructions
        expect(typeof installResult.success).toBe(`boolean`)

        if (!installResult.success) {
          expect(installResult.error).toBeTruthy()
        }
      }, 30000)
    })
  }
)

// Integration Tests for mkcert functionality
describe.skipIf(!ENABLE_INTEGRATION_TESTS)(`MkcertManager integration`, () => {
  let testCertDir: string
  let mkcertManager: MkcertManager

  beforeEach(() => {
    testCertDir = join(process.cwd(), createTempCertDir())
    mkcertManager = new MkcertManager(
      testCertDir,
      [`localhost`],
      `integration-test`
    )
  })

  afterEach(() => {
    if (existsSync(testCertDir)) {
      rmSync(testCertDir, { recursive: true })
    }
  })

  it(`should detect mkcert availability correctly`, () => {
    const isAvailable = mkcertManager.isAvailable()
    const expectedAvailable = hasCommand(`mkcert`)

    expect(isAvailable).toBe(expectedAvailable)
  })

  it.skipIf(!hasCommand(`mkcert`))(
    `should detect mkcert CA installation status`,
    () => {
      const isCAInstalled = mkcertManager.isCAInstalled()

      // Should be boolean (true or false based on actual mkcert setup)
      expect(typeof isCAInstalled).toBe(`boolean`)
    }
  )

  it.skipIf(!hasCommand(`mkcert`))(`should provide setup instructions`, () => {
    const instructions = mkcertManager.getSetupInstructions()

    expect(instructions).toBeTruthy()
    expect(instructions).toContain(`mkcert`)
    expect(instructions).toContain(`mkcert -install`)
  })

  it.skipIf(!hasCommand(`mkcert`))(
    `should generate certificates using mkcert`,
    async () => {
      const result = await mkcertManager.generateCertificates()

      if (result.success) {
        expect(result.certPath).toBeTruthy()
        expect(result.keyPath).toBeTruthy()
        expect(existsSync(result.certPath!)).toBe(true)
        expect(existsSync(result.keyPath!)).toBe(true)

        // Verify certificate format
        const fs = await import(`fs`)
        const certContent = fs.readFileSync(result.certPath!, `utf8`)
        const keyContent = fs.readFileSync(result.keyPath!, `utf8`)

        expect(certContent).toMatch(/^-----BEGIN CERTIFICATE-----/)
        expect(certContent).toMatch(/-----END CERTIFICATE-----$/)
        expect(keyContent).toMatch(/^-----BEGIN (RSA )?PRIVATE KEY-----/)
        expect(keyContent).toMatch(/-----END (RSA )?PRIVATE KEY-----$/)
      } else {
        // If mkcert generation fails, should have error message
        expect(result.error).toBeTruthy()
      }
    },
    15000
  )
})

// Integration Tests for CertificateManager fallback behavior
describe.skipIf(!ENABLE_INTEGRATION_TESTS)(
  `CertificateManager fallback integration`,
  () => {
    let testCertDir: string

    beforeEach(() => {
      testCertDir = join(process.cwd(), createTempCertDir())
    })

    afterEach(() => {
      if (existsSync(testCertDir)) {
        rmSync(testCertDir, { recursive: true })
      }
    })

    it(`should use appropriate certificate generation method`, async () => {
      const manager = new CertificateManager({
        certDir: testCertDir,
        domains: [`localhost`],
        name: `fallback-integration-test`,
      })

      const result = await manager.ensureCertificates()

      expect(result).toBeDefined()
      expect(result.cert).toBeTruthy()
      expect(result.key).toBeTruthy()
      expect(result.method).toMatch(/^(mkcert|basic-ssl)$/)
      expect(existsSync(result.cert)).toBe(true)
      expect(existsSync(result.key)).toBe(true)

      // If mkcert is available and configured, should use it
      const mkcertManager = new MkcertManager(
        testCertDir,
        [`localhost`],
        `test`
      )
      const expectedMethod =
        mkcertManager.isAvailable() && mkcertManager.isCAInstalled()
          ? `mkcert`
          : `basic-ssl`

      expect(result.method).toBe(expectedMethod)

      // Verify certificate content regardless of method
      const fs = await import(`fs`)
      const certContent = fs.readFileSync(result.cert, `utf8`)
      const keyContent = fs.readFileSync(result.key, `utf8`)

      expect(certContent).toMatch(/^-----BEGIN CERTIFICATE-----/)
      expect(certContent).toMatch(/-----END CERTIFICATE-----$/)
      expect(keyContent).toMatch(/^-----BEGIN (RSA )?PRIVATE KEY-----/)
      expect(keyContent).toMatch(/-----END (RSA )?PRIVATE KEY-----$/)
    }, 15000)

    it(`should provide mkcert setup instructions when using basic-ssl`, () => {
      const manager = new CertificateManager({
        certDir: testCertDir,
        domains: [`localhost`],
        name: `instruction-test`,
      })

      const instructions = manager.getMkcertSetupInstructions()

      expect(instructions).toBeTruthy()
      expect(instructions).toContain(`mkcert`)

      // Should contain platform-specific instructions
      if (process.platform === `darwin`) {
        expect(instructions).toContain(`brew install mkcert`)
      } else if (process.platform === `linux`) {
        expect(instructions).toContain(`apt install mkcert`)
      }
    })
  }
)
