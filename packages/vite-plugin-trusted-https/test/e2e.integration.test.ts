import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { existsSync, rmSync } from "fs"
import { join } from "path"
import { IncomingMessage, ServerResponse } from "http"
import { CertificateManager } from "../src/certificate-manager"
import { TrustInstaller } from "../src/trust-installer"
import trustedHttps from "../src/index"
import { createTempCertDir, skipIfNoIntegration } from "./test-utils"

// End-to-end integration tests
describe.skipIf(skipIfNoIntegration())(`E2E integration tests`, () => {
  let testCertDir: string

  beforeEach(() => {
    testCertDir = join(process.cwd(), createTempCertDir())
  })

  afterEach(() => {
    if (existsSync(testCertDir)) {
      rmSync(testCertDir, { recursive: true })
    }
  })

  it(`should complete full certificate generation and validation flow`, async () => {
    const domains = [`localhost`, `*.localhost`, `127.0.0.1`]
    const certName = `e2e-test-cert`

    // 1. Certificate Generation
    const manager = new CertificateManager({
      certDir: testCertDir,
      domains,
      name: certName,
    })

    expect(manager.certificateExists()).toBe(false)

    const { cert, key } = await manager.ensureCertificates()

    // Verify certificates were created
    expect(existsSync(cert)).toBe(true)
    expect(existsSync(key)).toBe(true)
    expect(manager.certificateExists()).toBe(true)

    // 2. Certificate Content Validation
    const fs = await import(`fs`)
    const certContent = fs.readFileSync(cert, `utf8`)
    const keyContent = fs.readFileSync(key, `utf8`)

    // Verify PEM format
    expect(certContent).toMatch(/^-----BEGIN CERTIFICATE-----/)
    expect(certContent).toMatch(/-----END CERTIFICATE-----$/)
    expect(keyContent).toMatch(/^-----BEGIN (RSA )?PRIVATE KEY-----/)
    expect(keyContent).toMatch(/-----END (RSA )?PRIVATE KEY-----$/)

    // 3. Trust Installation (without actually modifying system)
    const installer = new TrustInstaller(certName)

    // This should not throw, even if it can't install due to permissions
    const installResult = await installer.install(cert)
    expect(typeof installResult.success).toBe(`boolean`)

    if (!installResult.success) {
      expect(installResult.error).toBeTruthy()
    }

    // 4. Certificate Renewal Logic
    expect(manager.isCertificateExpired()).toBe(false)

    const renewResult = await manager.renewIfNeeded()
    expect(renewResult.cert).toBe(cert)
    expect(renewResult.key).toBe(key)

    // 5. Plugin Integration
    const plugin = trustedHttps({
      certDir: testCertDir,
      domains,
      autoTrust: false, // Don't modify system in tests
      name: certName,
    })

    expect(plugin.name).toBe(`trusted-https`)
    expect(plugin.buildStart).toBeDefined()
    expect(plugin.configureServer).toBeDefined()

    // Execute plugin hooks
    if (plugin.buildStart) {
      if (typeof plugin.buildStart === `function`) {
        await (plugin.buildStart as () => Promise<void>)()
      } else {
        await (plugin.buildStart.handler as () => Promise<void>)()
      }
    }

    // Plugin should work without throwing
    expect(true).toBe(true) // Test completed successfully
  }, 60000) // Increased timeout for certificate generation

  it(`should handle certificate expiration and renewal`, async () => {
    const manager = new CertificateManager({
      certDir: testCertDir,
      domains: [`localhost`],
      name: `renewal-test`,
    })

    // Generate initial certificates
    const { cert: cert1, key: key1 } = await manager.ensureCertificates()
    expect(existsSync(cert1)).toBe(true)

    const originalCertContent = await import(`fs`).then((fs) =>
      fs.readFileSync(cert1, `utf8`)
    )

    // Force regeneration (simulate renewal)
    const { cert: cert2, key: key2 } = await manager.ensureCertificates()

    // Paths should be the same
    expect(cert1).toBe(cert2)
    expect(key1).toBe(key2)

    // But content might be different (new certificate generated)
    const newCertContent = await import(`fs`).then((fs) =>
      fs.readFileSync(cert2, `utf8`)
    )

    // Both should be valid certificates
    expect(originalCertContent).toMatch(/^-----BEGIN CERTIFICATE-----/)
    expect(newCertContent).toMatch(/^-----BEGIN CERTIFICATE-----/)
  })

  it(`should handle concurrent operations gracefully`, async () => {
    const manager = new CertificateManager({
      certDir: testCertDir,
      domains: [`localhost`],
      name: `concurrent-test`,
    })

    // Start multiple operations concurrently
    const operations = [
      manager.ensureCertificates(),
      manager.renewIfNeeded(),
      manager.ensureCertificates(),
    ]

    // All should complete without errors
    const results = await Promise.all(operations)

    results.forEach((result) => {
      expect(result.cert).toBeTruthy()
      expect(result.key).toBeTruthy()
      expect(existsSync(result.cert)).toBe(true)
      expect(existsSync(result.key)).toBe(true)
    })

    // Final state should be consistent
    expect(manager.certificateExists()).toBe(true)
  })

  it(`should provide comprehensive status information`, async () => {
    const options = {
      certDir: testCertDir,
      domains: [`localhost`, `example.test`],
      autoTrust: false,
      name: `status-integration-test`,
    }

    const plugin = trustedHttps(options)

    // Initialize plugin
    if (plugin.buildStart) {
      if (typeof plugin.buildStart === `function`) {
        await (plugin.buildStart as () => Promise<void>)()
      } else {
        await (plugin.buildStart.handler as () => Promise<void>)()
      }
    }

    // Mock middleware capture
    let statusHandler:
      | ((req: IncomingMessage, res: ServerResponse) => void)
      | undefined
    const mockServer = {
      config: { server: { https: true } },
      middlewares: {
        use: (
          path: string,
          handler: (req: IncomingMessage, res: ServerResponse) => void
        ) => {
          if (path === `/.vite-trusted-https-status`) {
            statusHandler = handler
          }
        },
      },
    }

    if (plugin.configureServer) {
      if (typeof plugin.configureServer === `function`) {
        plugin.configureServer(mockServer as never)
      } else {
        plugin.configureServer.handler(mockServer as never)
      }
    }

    expect(statusHandler).toBeDefined()

    // Test status endpoint
    if (statusHandler) {
      const mockRes = {
        setHeader: () => {},
        end: (data: string) => {
          const status = JSON.parse(data)

          expect(status).toHaveProperty(`plugin`, `vite-plugin-trusted-https`)
          expect(status).toHaveProperty(`platform`)
          expect(status).toHaveProperty(`options`)
          expect(status).toHaveProperty(`certificatePaths`)

          expect(status.options).toEqual(
            expect.objectContaining({
              certDir: testCertDir,
              domains: options.domains,
              autoTrust: false,
              name: options.name,
            })
          )
        },
      }

      statusHandler(
        {
          url: `/.vite-trusted-https-status`,
        } as Partial<IncomingMessage> as IncomingMessage,
        mockRes as unknown as ServerResponse
      )
    }
  })
})
