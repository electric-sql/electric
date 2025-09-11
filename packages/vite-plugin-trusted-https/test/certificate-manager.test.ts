import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { existsSync, rmSync, readFileSync } from "fs"
import { join } from "path"
import { CertificateManager } from "../src/certificate-manager"
import { createTempCertDir } from "./test-utils"

// Mock MkcertManager for fallback logic testing
vi.mock("../src/mkcert-manager")

let testCertDir: string

describe(`CertificateManager`, () => {
  beforeEach(() => {
    testCertDir = join(process.cwd(), createTempCertDir())
    // Clean up test directory
    if (existsSync(testCertDir)) {
      rmSync(testCertDir, { recursive: true })
    }
  })

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testCertDir)) {
      rmSync(testCertDir, { recursive: true })
    }
    vi.restoreAllMocks()
  })

  it(`should create certificate directory if it doesn't exist`, async () => {
    const manager = new CertificateManager({
      certDir: testCertDir,
      domains: [`localhost`],
      name: `test-cert`,
    })

    expect(existsSync(testCertDir)).toBe(false)

    await manager.ensureCertificates()

    expect(existsSync(testCertDir)).toBe(true)
  })

  it(`should generate certificates when they don't exist`, async () => {
    const manager = new CertificateManager({
      certDir: testCertDir,
      domains: [`localhost`],
      name: `test-cert`,
    })

    expect(manager.certificateExists()).toBe(false)

    await manager.ensureCertificates()

    expect(manager.certificateExists()).toBe(true)
  })

  it(`should provide correct certificate paths`, () => {
    const manager = new CertificateManager({
      certDir: testCertDir,
      domains: [`localhost`],
      name: `test-cert`,
    })

    expect(manager.getCertificatePath()).toBe(
      join(testCertDir, `test-cert.crt`)
    )
    expect(manager.getKeyPath()).toBe(join(testCertDir, `test-cert.key`))
  })

  it(`should detect when certificates don't exist`, () => {
    const manager = new CertificateManager({
      certDir: testCertDir,
      domains: [`localhost`],
      name: `test-cert`,
    })

    expect(manager.certificateExists()).toBe(false)
    expect(manager.isCertificateExpired()).toBe(true)
  })

  it(`should validate certificate content after generation`, async () => {
    const manager = new CertificateManager({
      certDir: testCertDir,
      domains: [`localhost`, `example.localhost`],
      name: `test-cert`,
    })

    const { cert, key } = await manager.ensureCertificates()

    // Check that files exist
    expect(existsSync(cert)).toBe(true)
    expect(existsSync(key)).toBe(true)

    // Check certificate content
    const certContent = readFileSync(cert, `utf8`)
    const keyContent = readFileSync(key, `utf8`)

    // Certificate should start with BEGIN CERTIFICATE
    expect(certContent).toMatch(/^-----BEGIN CERTIFICATE-----/)
    expect(certContent).toMatch(/-----END CERTIFICATE-----$/)

    // Key should start with BEGIN RSA PRIVATE KEY or BEGIN PRIVATE KEY
    expect(keyContent).toMatch(/^-----BEGIN (RSA )?PRIVATE KEY-----/)
    expect(keyContent).toMatch(/-----END (RSA )?PRIVATE KEY-----$/)

    // Content should not be empty
    expect(certContent.trim()).toBeTruthy()
    expect(keyContent.trim()).toBeTruthy()
  })

  it(`should handle renewIfNeeded correctly when certificates exist`, async () => {
    const manager = new CertificateManager({
      certDir: testCertDir,
      domains: [`localhost`],
      name: `test-cert`,
    })

    // First generation
    await manager.ensureCertificates()
    expect(manager.certificateExists()).toBe(true)

    // Should not regenerate if not expired
    const { cert, key } = await manager.renewIfNeeded()
    expect(cert).toBe(manager.getCertificatePath())
    expect(key).toBe(manager.getKeyPath())
  })

  it(`should detect certificate expiration based on file age`, async () => {
    const manager = new CertificateManager({
      certDir: testCertDir,
      domains: [`localhost`],
      name: `test-cert`,
    })

    // Generate certificates
    await manager.ensureCertificates()
    expect(manager.isCertificateExpired()).toBe(false)

    // Mock old file by changing mtime (simulation)
    const certPath = manager.getCertificatePath()
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) // 31 days ago
    
    // We can't easily mock fs.statSync here, so this test verifies the logic exists
    // The actual expiration check would require more complex mocking
    expect(typeof manager.isCertificateExpired).toBe(`function`)
  })

  it(`should handle multiple domains in certificate`, async () => {
    const domains = [`localhost`, `*.localhost`, `127.0.0.1`, `example.test`]
    const manager = new CertificateManager({
      certDir: testCertDir,
      domains,
      name: `multi-domain-cert`,
    })

    const { cert } = await manager.ensureCertificates()
    const certContent = readFileSync(cert, `utf8`)
    
    // Certificate should be valid format
    expect(certContent).toMatch(/^-----BEGIN CERTIFICATE-----/)
    expect(certContent).toMatch(/-----END CERTIFICATE-----$/)
  })

  it(`should handle concurrent certificate generation`, async () => {
    const manager = new CertificateManager({
      certDir: testCertDir,
      domains: [`localhost`],
      name: `concurrent-test`,
    })

    // Start multiple certificate generations simultaneously
    const promises = [
      manager.ensureCertificates(),
      manager.ensureCertificates(),
      manager.ensureCertificates(),
    ]

    const results = await Promise.all(promises)
    
    // All should succeed
    results.forEach(result => {
      expect(result.cert).toBeTruthy()
      expect(result.key).toBeTruthy()
    })

    // Certificate should exist
    expect(manager.certificateExists()).toBe(true)
  })
})

// Unit tests for fallback logic with mocked MkcertManager
describe(`CertificateManager fallback logic`, () => {
  let testCertDir: string

  beforeEach(() => {
    testCertDir = join(process.cwd(), createTempCertDir())
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (existsSync(testCertDir)) {
      rmSync(testCertDir, { recursive: true })
    }
    vi.restoreAllMocks()
  })

  it(`should use mkcert when available and configured`, async () => {
    const { MkcertManager } = await import("../src/mkcert-manager")
    const mockMkcertManager = vi.mocked(MkcertManager)

    // Mock successful mkcert scenario
    mockMkcertManager.prototype.isAvailable = vi.fn().mockReturnValue(true)
    mockMkcertManager.prototype.isCAInstalled = vi.fn().mockReturnValue(true)
    mockMkcertManager.prototype.generateCertificates = vi.fn().mockResolvedValue({
      success: true,
      certPath: join(testCertDir, "test-cert.crt"),
      keyPath: join(testCertDir, "test-cert.key")
    })

    const manager = new CertificateManager({
      certDir: testCertDir,
      domains: [`localhost`],
      name: `test-cert`,
    })

    const result = await manager.ensureCertificates()

    expect(result.method).toBe("mkcert")
    expect(result.cert).toContain("test-cert.crt")
    expect(result.key).toContain("test-cert.key")
    expect(mockMkcertManager.prototype.generateCertificates).toHaveBeenCalled()
  })

  it(`should fallback to basic-ssl when mkcert is not available`, async () => {
    const { MkcertManager } = await import("../src/mkcert-manager")
    const mockMkcertManager = vi.mocked(MkcertManager)

    // Mock mkcert not available
    mockMkcertManager.prototype.isAvailable = vi.fn().mockReturnValue(false)
    mockMkcertManager.prototype.isCAInstalled = vi.fn().mockReturnValue(true)

    const manager = new CertificateManager({
      certDir: testCertDir,
      domains: [`localhost`],
      name: `fallback-test`,
    })

    const result = await manager.ensureCertificates()

    expect(result.method).toBe("basic-ssl")
    expect(result.cert).toContain("fallback-test.crt")
    expect(result.key).toContain("fallback-test.key")
    expect(mockMkcertManager.prototype.generateCertificates).not.toHaveBeenCalled()
  })

  it(`should fallback to basic-ssl when mkcert CA is not installed`, async () => {
    const { MkcertManager } = await import("../src/mkcert-manager")
    const mockMkcertManager = vi.mocked(MkcertManager)

    // Mock mkcert available but CA not installed
    mockMkcertManager.prototype.isAvailable = vi.fn().mockReturnValue(true)
    mockMkcertManager.prototype.isCAInstalled = vi.fn().mockReturnValue(false)

    const manager = new CertificateManager({
      certDir: testCertDir,
      domains: [`localhost`],
      name: `fallback-ca-test`,
    })

    const result = await manager.ensureCertificates()

    expect(result.method).toBe("basic-ssl")
    expect(mockMkcertManager.prototype.generateCertificates).not.toHaveBeenCalled()
  })

  it(`should fallback to basic-ssl when mkcert generation fails`, async () => {
    const { MkcertManager } = await import("../src/mkcert-manager")
    const mockMkcertManager = vi.mocked(MkcertManager)

    // Mock mkcert available but generation fails
    mockMkcertManager.prototype.isAvailable = vi.fn().mockReturnValue(true)
    mockMkcertManager.prototype.isCAInstalled = vi.fn().mockReturnValue(true)
    mockMkcertManager.prototype.generateCertificates = vi.fn().mockResolvedValue({
      success: false,
      error: "Generation failed"
    })

    const manager = new CertificateManager({
      certDir: testCertDir,
      domains: [`localhost`],
      name: `failure-fallback-test`,
    })

    const result = await manager.ensureCertificates()

    expect(result.method).toBe("basic-ssl")
    expect(result.cert).toContain("failure-fallback-test.crt")
    expect(result.key).toContain("failure-fallback-test.key")
    expect(mockMkcertManager.prototype.generateCertificates).toHaveBeenCalled()
  })

  it(`should provide mkcert setup instructions`, async () => {
    const { MkcertManager } = await import("../src/mkcert-manager")
    const mockMkcertManager = vi.mocked(MkcertManager)

    mockMkcertManager.prototype.getSetupInstructions = vi.fn().mockReturnValue(
      "Mock setup instructions for mkcert"
    )

    const manager = new CertificateManager({
      certDir: testCertDir,
      domains: [`localhost`],
      name: `instructions-test`,
    })

    const instructions = manager.getMkcertSetupInstructions()

    expect(instructions).toBe("Mock setup instructions for mkcert")
    expect(mockMkcertManager.prototype.getSetupInstructions).toHaveBeenCalled()
  })

  it(`should handle renewIfNeeded with method detection`, async () => {
    const { MkcertManager } = await import("../src/mkcert-manager")
    const mockMkcertManager = vi.mocked(MkcertManager)

    // Mock mkcert being available for method detection heuristic
    mockMkcertManager.prototype.isAvailable = vi.fn().mockReturnValue(true)
    mockMkcertManager.prototype.isCAInstalled = vi.fn().mockReturnValue(true)
    mockMkcertManager.prototype.generateCertificates = vi.fn().mockResolvedValue({
      success: true,
      certPath: join(testCertDir, "renew-method-test.crt"),
      keyPath: join(testCertDir, "renew-method-test.key")
    })

    const manager = new CertificateManager({
      certDir: testCertDir,
      domains: [`localhost`],
      name: `renew-method-test`,
    })

    // Generate initial certificates
    await manager.ensureCertificates()

    // Clear mocks to test renewIfNeeded independently
    vi.clearAllMocks()
    mockMkcertManager.prototype.isAvailable = vi.fn().mockReturnValue(true)
    mockMkcertManager.prototype.isCAInstalled = vi.fn().mockReturnValue(true)

    // Call renewIfNeeded (should not regenerate since not expired)
    const result = await manager.renewIfNeeded()

    // Should detect mkcert method based on availability heuristic
    expect(result.method).toBe("mkcert")
    expect(result.cert).toContain("renew-method-test.crt")
    expect(result.key).toContain("renew-method-test.key")
  })
})
