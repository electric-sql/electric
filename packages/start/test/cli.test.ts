import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the electric-api module
vi.mock(`../src/electric-api.js`, () => ({
  provisionElectricResources: vi.fn(),
  DEFAULT_ELECTRIC_API_BASE: `https://api.electric-sql.cloud`,
}))

// Mock the template-setup module
vi.mock(`../src/template-setup.js`, () => ({
  setupTemplate: vi.fn(),
}))

describe(`cli`, () => {
  const mockCredentials = {
    source_id: `test-source-id`,
    secret: `test-secret`,
    DATABASE_URL: `postgresql://test:test@localhost:5432/test`,
    claimId: `test-claim-id`,
  }

  let mockProvisionElectricResources: ReturnType<typeof vi.fn>
  let mockSetupTemplate: ReturnType<typeof vi.fn>
  let originalArgv: string[]
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let processExitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.clearAllMocks()

    // Store original argv
    originalArgv = [...process.argv]

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, `log`).mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, `error`).mockImplementation(() => {})

    // Mock process.exit to throw instead of exiting
    processExitSpy = vi
      .spyOn(process, `exit`)
      .mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`process.exit(${code})`)
      })

    // Get mocked functions
    const electricApi = await import(`../src/electric-api.js`)
    const templateSetup = await import(`../src/template-setup.js`)

    mockProvisionElectricResources =
      electricApi.provisionElectricResources as unknown as ReturnType<
        typeof vi.fn
      >
    mockSetupTemplate = templateSetup.setupTemplate as unknown as ReturnType<
      typeof vi.fn
    >
  })

  afterEach(() => {
    // Restore original argv
    process.argv = originalArgv

    // Restore spies
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    processExitSpy.mockRestore()

    vi.resetAllMocks()
  })

  describe(`main`, () => {
    it(`should exit with error when no app name provided`, async () => {
      process.argv = [`node`, `cli.js`]

      const { main } = await import(`../src/cli.js`)

      await expect(main()).rejects.toThrow(`process.exit(1)`)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Usage: npx @electric-sql/start <app-name>`
      )
    })

    it(`should exit with error for invalid app name`, async () => {
      process.argv = [`node`, `cli.js`, `my app with spaces`]

      const { main } = await import(`../src/cli.js`)

      await expect(main()).rejects.toThrow(`process.exit(1)`)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `App name must contain only letters, numbers, hyphens, and underscores`
      )
    })

    it(`should exit with error for app name with special characters`, async () => {
      process.argv = [`node`, `cli.js`, `my@app!`]

      const { main } = await import(`../src/cli.js`)

      await expect(main()).rejects.toThrow(`process.exit(1)`)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `App name must contain only letters, numbers, hyphens, and underscores`
      )
    })

    it(`should provision resources and setup template for valid app name`, async () => {
      process.argv = [`node`, `cli.js`, `my-valid-app`]
      mockProvisionElectricResources.mockResolvedValue(mockCredentials)
      mockSetupTemplate.mockResolvedValue(undefined)

      const { main } = await import(`../src/cli.js`)

      await main()

      expect(mockProvisionElectricResources).toHaveBeenCalledTimes(1)
      expect(mockSetupTemplate).toHaveBeenCalledWith(
        `my-valid-app`,
        mockCredentials
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(`Creating app: my-valid-app`)
      expect(consoleLogSpy).toHaveBeenCalledWith(`Setup complete`)
    })

    it(`should handle provisioning errors`, async () => {
      process.argv = [`node`, `cli.js`, `my-app`]
      mockProvisionElectricResources.mockRejectedValue(
        new Error(`API connection failed`)
      )

      const { main } = await import(`../src/cli.js`)

      await expect(main()).rejects.toThrow(`process.exit(1)`)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Setup failed:`,
        `API connection failed`
      )
      expect(mockSetupTemplate).not.toHaveBeenCalled()
    })

    it(`should handle template setup errors`, async () => {
      process.argv = [`node`, `cli.js`, `my-app`]
      mockProvisionElectricResources.mockResolvedValue(mockCredentials)
      mockSetupTemplate.mockRejectedValue(new Error(`Template download failed`))

      const { main } = await import(`../src/cli.js`)

      await expect(main()).rejects.toThrow(`process.exit(1)`)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Setup failed:`,
        `Template download failed`
      )
    })

    it(`should display next steps after successful setup`, async () => {
      process.argv = [`node`, `cli.js`, `my-app`]
      mockProvisionElectricResources.mockResolvedValue(mockCredentials)
      mockSetupTemplate.mockResolvedValue(undefined)

      const { main } = await import(`../src/cli.js`)

      await main()

      expect(consoleLogSpy).toHaveBeenCalledWith(`Next steps:`)
      expect(consoleLogSpy).toHaveBeenCalledWith(`  cd my-app`)
      expect(consoleLogSpy).toHaveBeenCalledWith(`  pnpm install`)
      expect(consoleLogSpy).toHaveBeenCalledWith(`  pnpm migrate`)
      expect(consoleLogSpy).toHaveBeenCalledWith(`  pnpm dev`)
    })

    it(`should display available commands after successful setup`, async () => {
      process.argv = [`node`, `cli.js`, `my-app`]
      mockProvisionElectricResources.mockResolvedValue(mockCredentials)
      mockSetupTemplate.mockResolvedValue(undefined)

      const { main } = await import(`../src/cli.js`)

      await main()

      expect(consoleLogSpy).toHaveBeenCalledWith(`Commands:`)
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `  pnpm psql             # Connect to database`
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `  pnpm claim            # Claim cloud resources`
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `  pnpm deploy:netlify   # Deploy to Netlify`
      )
    })

    it(`should accept app names with underscores`, async () => {
      process.argv = [`node`, `cli.js`, `my_valid_app`]
      mockProvisionElectricResources.mockResolvedValue(mockCredentials)
      mockSetupTemplate.mockResolvedValue(undefined)

      const { main } = await import(`../src/cli.js`)

      await main()

      expect(mockSetupTemplate).toHaveBeenCalledWith(
        `my_valid_app`,
        mockCredentials
      )
    })

    it(`should accept app names with numbers`, async () => {
      process.argv = [`node`, `cli.js`, `my-app-123`]
      mockProvisionElectricResources.mockResolvedValue(mockCredentials)
      mockSetupTemplate.mockResolvedValue(undefined)

      const { main } = await import(`../src/cli.js`)

      await main()

      expect(mockSetupTemplate).toHaveBeenCalledWith(
        `my-app-123`,
        mockCredentials
      )
    })

    it(`should accept "." as app name for current directory mode`, async () => {
      process.argv = [`node`, `cli.js`, `.`]
      mockProvisionElectricResources.mockResolvedValue(mockCredentials)
      mockSetupTemplate.mockResolvedValue(undefined)

      const { main } = await import(`../src/cli.js`)

      await main()

      expect(mockProvisionElectricResources).toHaveBeenCalledTimes(1)
      expect(mockSetupTemplate).toHaveBeenCalledWith(`.`, mockCredentials)
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `Configuring current directory...`
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(`Setup complete`)
    })

    it(`should not display "cd" instruction when using "."`, async () => {
      process.argv = [`node`, `cli.js`, `.`]
      mockProvisionElectricResources.mockResolvedValue(mockCredentials)
      mockSetupTemplate.mockResolvedValue(undefined)

      const { main } = await import(`../src/cli.js`)

      await main()

      expect(consoleLogSpy).not.toHaveBeenCalledWith(`  cd .`)
      expect(consoleLogSpy).toHaveBeenCalledWith(`  pnpm install`)
    })

    it(`should handle non-Error thrown values`, async () => {
      process.argv = [`node`, `cli.js`, `my-app`]
      mockProvisionElectricResources.mockRejectedValue(`string error`)

      const { main } = await import(`../src/cli.js`)

      await expect(main()).rejects.toThrow(`process.exit(1)`)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Setup failed:`,
        `string error`
      )
    })
  })
})
