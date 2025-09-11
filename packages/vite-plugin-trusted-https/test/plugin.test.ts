import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync, existsSync, rmSync } from "fs"
import { join } from "path"
import trustedHttps from "../src/index"
import type { ViteDevServer } from "vite"
import { createTempCertDir, skipIfNoIntegration } from "./test-utils"

// Mock dependencies
vi.mock(`fs`)
vi.mock(`../src/certificate-manager`)
vi.mock(`../src/trust-installer`)

const mockReadFileSync = vi.mocked(readFileSync)

describe(`trustedHttps plugin`, () => {
  let testCertDir: string

  beforeEach(() => {
    testCertDir = join(process.cwd(), createTempCertDir())
    vi.clearAllMocks()
    mockReadFileSync.mockReturnValue(`mock certificate content`)
  })

  afterEach(() => {
    if (existsSync(testCertDir)) {
      rmSync(testCertDir, { recursive: true })
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it(`should create a plugin with correct name`, () => {
    const plugin = trustedHttps()

    expect(plugin.name).toBe(`trusted-https`)
    expect(plugin).toHaveProperty(`buildStart`)
    expect(plugin).toHaveProperty(`configureServer`)
  })

  it(`should accept custom options`, () => {
    const options = {
      certDir: `./custom-certs`,
      domains: [`example.com`, `localhost`],
      autoTrust: false,
      fallback: false,
      name: `custom-cert`,
    }

    const plugin = trustedHttps(options)
    expect(plugin.name).toBe(`trusted-https`)
  })

  it(`should use default options when none provided`, () => {
    const plugin = trustedHttps()
    expect(plugin.name).toBe(`trusted-https`)
  })

  it(`should have buildStart hook`, () => {
    const plugin = trustedHttps()

    expect(plugin).toHaveProperty(`buildStart`)
    expect(typeof plugin.buildStart).toBe(`function`)
  })

  it(`should have configureServer hook`, () => {
    const plugin = trustedHttps({ autoTrust: false })

    expect(plugin).toHaveProperty(`configureServer`)
    expect(typeof plugin.configureServer).toBe(`function`)
  })

  it(`should export TrustedHttpsOptions interface`, () => {
    // This is a compile-time test to ensure TypeScript types are exported
    const options: import("../src/index").TrustedHttpsOptions = {
      certDir: `./test-certs`,
      domains: [`localhost`],
      autoTrust: true,
      fallback: true,
      name: `test-cert`,
    }

    expect(options).toBeDefined()
  })
})

// Integration tests for plugin hooks
describe.skipIf(skipIfNoIntegration())(`trustedHttps plugin integration`, () => {
  let testCertDir: string

  beforeEach(() => {
    testCertDir = join(process.cwd(), createTempCertDir())
  })

  afterEach(() => {
    if (existsSync(testCertDir)) {
      rmSync(testCertDir, { recursive: true })
    }
  })

  it(`should execute buildStart hook without errors`, async () => {
    const plugin = trustedHttps({
      certDir: testCertDir,
      domains: [`localhost`],
      autoTrust: false, // Don't modify system trust store in tests
      name: `integration-test`,
    })

    expect(plugin.buildStart).toBeDefined()
    
    // Call buildStart hook
    if (plugin.buildStart) {
      await plugin.buildStart.call({}, {})
    }

    // Should not throw and plugin should be properly initialized
    expect(plugin.name).toBe(`trusted-https`)
  })

  it(`should execute configureServer hook and set up HTTPS`, async () => {
    const plugin = trustedHttps({
      certDir: testCertDir,
      domains: [`localhost`],
      autoTrust: false, // Don't modify system trust store in tests
      name: `integration-test`,
    })

    // Mock ViteDevServer
    const mockServer: Partial<ViteDevServer> = {
      config: {
        server: {
          https: true
        }
      } as any,
      middlewares: {
        use: vi.fn()
      } as any
    }

    expect(plugin.configureServer).toBeDefined()

    // Call buildStart first
    if (plugin.buildStart) {
      await plugin.buildStart.call({}, {})
    }

    // Call configureServer hook
    if (plugin.configureServer) {
      await plugin.configureServer(mockServer as ViteDevServer)
    }

    // Should have added middleware for status endpoint
    expect(mockServer.middlewares?.use).toHaveBeenCalled()
  })

  it(`should provide status endpoint data`, async () => {
    const options = {
      certDir: testCertDir,
      domains: [`localhost`],
      autoTrust: false,
      name: `status-test`,
    }
    
    const plugin = trustedHttps(options)

    // Mock ViteDevServer and middleware calls
    let statusEndpointHandler: Function | undefined
    const mockServer: Partial<ViteDevServer> = {
      config: {
        server: { https: true }
      } as any,
      middlewares: {
        use: vi.fn((path: string, handler: Function) => {
          if (path === `/.vite-trusted-https-status`) {
            statusEndpointHandler = handler
          }
        })
      } as any
    }

    // Initialize plugin
    if (plugin.buildStart) {
      await plugin.buildStart.call({}, {})
    }
    if (plugin.configureServer) {
      await plugin.configureServer(mockServer as ViteDevServer)
    }

    // Test status endpoint
    expect(statusEndpointHandler).toBeDefined()

    if (statusEndpointHandler) {
      const mockReq = { url: `/.vite-trusted-https-status` }
      const mockRes = {
        setHeader: vi.fn(),
        end: vi.fn(),
      }

      statusEndpointHandler(mockReq, mockRes)

      // Should have set JSON content type and responded
      expect(mockRes.setHeader).toHaveBeenCalledWith(`Content-Type`, `application/json`)
      expect(mockRes.end).toHaveBeenCalled()

      // Check the response data structure
      const responseData = JSON.parse(mockRes.end.mock.calls[0][0])
      expect(responseData).toHaveProperty(`plugin`)
      expect(responseData).toHaveProperty(`platform`)
      expect(responseData).toHaveProperty(`options`)
      expect(responseData).toHaveProperty(`certificateMethod`)
      expect(responseData.plugin).toBe(`vite-plugin-trusted-https`)
      expect(responseData.options).toEqual(expect.objectContaining(options))
      expect(['mkcert', 'basic-ssl', null]).toContain(responseData.certificateMethod)
    }
  }, 10000)
})
