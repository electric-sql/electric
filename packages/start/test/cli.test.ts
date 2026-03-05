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

// Mock child_process execSync
vi.mock(`child_process`, () => ({
  execSync: vi.fn(),
}))

// Mock readline for prompt testing
const mockQuestion = vi.fn()
const mockClose = vi.fn()
vi.mock(`readline`, () => ({
  createInterface: vi.fn(() => ({
    question: mockQuestion,
    close: mockClose,
  })),
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
        `Usage: npx @electric-sql/start <app-name> [--source <source-id>] [--secret <secret>] [--database-url <url>]`
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
      // pnpm install and pnpm migrate are no longer shown because they run automatically
      expect(consoleLogSpy).not.toHaveBeenCalledWith(`  pnpm install`)
      expect(consoleLogSpy).not.toHaveBeenCalledWith(`  pnpm migrate`)
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
      // pnpm install runs automatically, so it's not shown in next steps
      expect(consoleLogSpy).toHaveBeenCalledWith(`  pnpm dev`)
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

    it(`should exit with error when multiple positional arguments provided`, async () => {
      process.argv = [`node`, `cli.js`, `my-app`, `another-app`]

      const { main } = await import(`../src/cli.js`)

      await expect(main()).rejects.toThrow(`process.exit(1)`)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Error: Expected only one app name, but received multiple: my-app, another-app`
      )
    })

    it(`should exit with error when --source flag has no value`, async () => {
      process.argv = [`node`, `cli.js`, `my-app`, `--source`]

      const { main } = await import(`../src/cli.js`)

      await expect(main()).rejects.toThrow(`process.exit(1)`)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Error: --source requires a source ID value`
      )
    })

    it(`should exit with error when --secret flag has no value`, async () => {
      process.argv = [
        `node`,
        `cli.js`,
        `my-app`,
        `--source`,
        `src-123`,
        `--secret`,
      ]

      const { main } = await import(`../src/cli.js`)

      await expect(main()).rejects.toThrow(`process.exit(1)`)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Error: --secret requires a value`
      )
    })

    it(`should exit with error when --database-url flag has no value`, async () => {
      process.argv = [
        `node`,
        `cli.js`,
        `my-app`,
        `--source`,
        `src-123`,
        `--secret`,
        `my-secret`,
        `--database-url`,
      ]

      const { main } = await import(`../src/cli.js`)

      await expect(main()).rejects.toThrow(`process.exit(1)`)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Error: --database-url requires a value`
      )
    })

    it(`should use provided credentials with --source, --secret, and --database-url`, async () => {
      process.argv = [
        `node`,
        `cli.js`,
        `my-app`,
        `--source`,
        `src-123`,
        `--secret`,
        `my-secret`,
        `--database-url`,
        `postgresql://localhost/mydb`,
      ]
      mockSetupTemplate.mockResolvedValue(undefined)

      const { main } = await import(`../src/cli.js`)

      await main()

      // Should NOT call provisionElectricResources when credentials are provided
      expect(mockProvisionElectricResources).not.toHaveBeenCalled()
      expect(mockSetupTemplate).toHaveBeenCalledWith(`my-app`, {
        source_id: `src-123`,
        secret: `my-secret`,
        DATABASE_URL: `postgresql://localhost/mydb`,
      })
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `Using provided credentials...`
      )
    })

    it(`should skip migrations when user provides credentials`, async () => {
      const { execSync } = await import(`child_process`)
      const mockExecSync = execSync as unknown as ReturnType<typeof vi.fn>

      process.argv = [
        `node`,
        `cli.js`,
        `my-app`,
        `--source`,
        `src-123`,
        `--secret`,
        `my-secret`,
        `--database-url`,
        `postgresql://localhost/mydb`,
      ]
      mockSetupTemplate.mockResolvedValue(undefined)

      const { main } = await import(`../src/cli.js`)

      await main()

      // Should only run pnpm install, NOT pnpm migrate
      const execCalls = mockExecSync.mock.calls.map(
        (call: unknown[]) => call[0]
      )
      expect(execCalls).toContain(`pnpm install`)
      expect(execCalls).not.toContain(`pnpm migrate`)
    })

    it(`should not show claim command when user provides credentials`, async () => {
      process.argv = [
        `node`,
        `cli.js`,
        `my-app`,
        `--source`,
        `src-123`,
        `--secret`,
        `my-secret`,
        `--database-url`,
        `postgresql://localhost/mydb`,
      ]
      mockSetupTemplate.mockResolvedValue(undefined)

      const { main } = await import(`../src/cli.js`)

      await main()

      // Should NOT show claim command when using provided credentials
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        `  pnpm claim            # Claim cloud resources`
      )
      // Should show migrate in next steps since it was skipped
      expect(consoleLogSpy).toHaveBeenCalledWith(`  pnpm migrate`)
    })

    it(`should prompt for secret and DATABASE_URL when only --source is provided`, async () => {
      process.argv = [`node`, `cli.js`, `my-app`, `--source`, `src-123`]
      mockSetupTemplate.mockResolvedValue(undefined)

      // Mock readline responses for prompts
      mockQuestion
        .mockImplementationOnce(
          (_question: string, callback: (answer: string) => void) => {
            callback(`prompted-secret`)
          }
        )
        .mockImplementationOnce(
          (_question: string, callback: (answer: string) => void) => {
            callback(`postgresql://prompted/db`)
          }
        )

      const { main } = await import(`../src/cli.js`)

      await main()

      expect(mockSetupTemplate).toHaveBeenCalledWith(`my-app`, {
        source_id: `src-123`,
        secret: `prompted-secret`,
        DATABASE_URL: `postgresql://prompted/db`,
      })
    })

    it(`should exit with error when prompted secret is empty`, async () => {
      process.argv = [`node`, `cli.js`, `my-app`, `--source`, `src-123`]

      // Mock readline to return empty secret
      mockQuestion.mockImplementationOnce(
        (_question: string, callback: (answer: string) => void) => {
          callback(``)
        }
      )

      const { main } = await import(`../src/cli.js`)

      await expect(main()).rejects.toThrow(`process.exit(1)`)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Error: Secret cannot be empty`
      )
    })

    it(`should exit with error when prompted DATABASE_URL is empty`, async () => {
      process.argv = [`node`, `cli.js`, `my-app`, `--source`, `src-123`]

      // Mock readline to return valid secret but empty DATABASE_URL
      mockQuestion
        .mockImplementationOnce(
          (_question: string, callback: (answer: string) => void) => {
            callback(`valid-secret`)
          }
        )
        .mockImplementationOnce(
          (_question: string, callback: (answer: string) => void) => {
            callback(``)
          }
        )

      const { main } = await import(`../src/cli.js`)

      await expect(main()).rejects.toThrow(`process.exit(1)`)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Error: DATABASE_URL cannot be empty`
      )
    })

    it(`should trim whitespace from provided credentials`, async () => {
      process.argv = [
        `node`,
        `cli.js`,
        `my-app`,
        `--source`,
        `src-123`,
        `--secret`,
        `  my-secret  `,
        `--database-url`,
        `  postgresql://localhost/mydb  `,
      ]
      mockSetupTemplate.mockResolvedValue(undefined)

      const { main } = await import(`../src/cli.js`)

      await main()

      expect(mockSetupTemplate).toHaveBeenCalledWith(`my-app`, {
        source_id: `src-123`,
        secret: `my-secret`,
        DATABASE_URL: `postgresql://localhost/mydb`,
      })
    })
  })
})
