import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync, existsSync, rmSync } from "fs"
import { join } from "path"
import { IncomingMessage, ServerResponse } from "http"
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
})

// Integration tests for plugin hooks
describe.skipIf(skipIfNoIntegration())(
  `trustedHttps plugin integration`,
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
        if (typeof plugin.buildStart === `function`) {
          await (plugin.buildStart as () => Promise<void>)()
        } else {
          await (plugin.buildStart.handler as () => Promise<void>)()
        }
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
      const mockServer = {
        config: {
          server: {
            https: true,
          },
        },
        middlewares: {
          use: vi.fn(),
        },
      } as unknown as ViteDevServer

      expect(plugin.configureServer).toBeDefined()

      // Call buildStart first
      if (plugin.buildStart) {
        if (typeof plugin.buildStart === `function`) {
          await (plugin.buildStart as () => Promise<void>)()
        } else {
          await (plugin.buildStart.handler as () => Promise<void>)()
        }
      }

      // Call configureServer hook
      if (plugin.configureServer) {
        if (typeof plugin.configureServer === `function`) {
          plugin.configureServer(mockServer)
        } else {
          plugin.configureServer.handler(mockServer)
        }
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
      let statusEndpointHandler:
        | ((req: IncomingMessage, res: ServerResponse) => void)
        | undefined
      const mockServer = {
        config: {
          server: { https: true },
        },
        middlewares: {
          use: vi.fn(
            (
              path: string,
              handler: (req: IncomingMessage, res: ServerResponse) => void
            ) => {
              if (path === `/.vite-trusted-https-status`) {
                statusEndpointHandler = handler
              }
            }
          ),
        },
      } as unknown as ViteDevServer

      // Initialize plugin
      if (plugin.buildStart) {
        if (typeof plugin.buildStart === `function`) {
          await (plugin.buildStart as () => Promise<void>)()
        } else {
          await (plugin.buildStart.handler as () => Promise<void>)()
        }
      }
      if (plugin.configureServer) {
        if (typeof plugin.configureServer === `function`) {
          plugin.configureServer(mockServer)
        } else {
          plugin.configureServer.handler(mockServer)
        }
      }

      // Test status endpoint
      expect(statusEndpointHandler).toBeDefined()

      if (statusEndpointHandler) {
        const mockReq = {
          url: `/.vite-trusted-https-status`,
        } as Partial<IncomingMessage> as IncomingMessage
        const mockRes = {
          setHeader: vi.fn(),
          end: vi.fn(),
        } as unknown as ServerResponse

        statusEndpointHandler(mockReq, mockRes)

        // Should have set JSON content type and responded
        expect(mockRes.setHeader).toHaveBeenCalledWith(
          `Content-Type`,
          `application/json`
        )
        expect(mockRes.end).toHaveBeenCalled()

        // Check the response data structure
        const responseData = JSON.parse(
          (mockRes.end as ReturnType<typeof vi.fn>).mock.calls[0][0]
        )
        expect(responseData).toHaveProperty(`plugin`)
        expect(responseData).toHaveProperty(`platform`)
        expect(responseData).toHaveProperty(`options`)
        expect(responseData).toHaveProperty(`certificateMethod`)
        expect(responseData.plugin).toBe(`vite-plugin-trusted-https`)
        expect(responseData.options).toEqual(expect.objectContaining(options))
        expect([`mkcert`, `basic-ssl`, null]).toContain(
          responseData.certificateMethod
        )
      }
    }, 10000)
  }
)
