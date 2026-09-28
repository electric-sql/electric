import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the template-setup module
vi.mock(`../src/template-setup.js`, () => ({
  setupTemplate: vi.fn(),
}))

// Mock child_process execSync
vi.mock(`child_process`, () => ({
  execSync: vi.fn(),
}))

describe(`cli`, () => {
  let mockSetupTemplate: ReturnType<typeof vi.fn>
  let mockExecSync: ReturnType<typeof vi.fn>
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

    const templateSetup = await import(`../src/template-setup.js`)
    const childProcess = await import(`child_process`)

    mockSetupTemplate = templateSetup.setupTemplate as unknown as ReturnType<
      typeof vi.fn
    >
    mockExecSync = childProcess.execSync as unknown as ReturnType<typeof vi.fn>
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

    it(`should exit with error when multiple positional arguments provided`, async () => {
      process.argv = [`node`, `cli.js`, `my-app`, `another-app`]

      const { main } = await import(`../src/cli.js`)

      await expect(main()).rejects.toThrow(`process.exit(1)`)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Error: Expected only one app name, but received multiple: my-app, another-app`
      )
    })

    it.each([`--source`, `--secret`, `--database-url`, `--whatever`])(
      `should reject the unknown option %s`,
      async (flag) => {
        process.argv = [`node`, `cli.js`, `my-app`, flag, `value`]

        const { main } = await import(`../src/cli.js`)

        await expect(main()).rejects.toThrow(`process.exit(1)`)
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          `Error: Unknown option: ${flag}`
        )
        expect(mockSetupTemplate).not.toHaveBeenCalled()
      }
    )

    it(`should setup template and install dependencies for valid app name`, async () => {
      process.argv = [`node`, `cli.js`, `my-valid-app`]
      mockSetupTemplate.mockResolvedValue(undefined)

      const { main } = await import(`../src/cli.js`)

      await main()

      expect(mockSetupTemplate).toHaveBeenCalledWith(`my-valid-app`)
      expect(consoleLogSpy).toHaveBeenCalledWith(`Creating app: my-valid-app`)
      expect(consoleLogSpy).toHaveBeenCalledWith(`Setup complete`)

      const execCalls = mockExecSync.mock.calls.map(
        (call: unknown[]) => call[0]
      )
      expect(execCalls).toEqual([`pnpm install`])
      expect(mockExecSync.mock.calls[0][1]).toMatchObject({
        cwd: expect.stringMatching(/my-valid-app$/),
      })
    })

    it(`should not start Docker or run migrations itself`, async () => {
      process.argv = [`node`, `cli.js`, `my-app`]
      mockSetupTemplate.mockResolvedValue(undefined)

      const { main } = await import(`../src/cli.js`)

      await main()

      const execCalls = mockExecSync.mock.calls.map(
        (call: unknown[]) => call[0] as string
      )
      expect(execCalls.some((cmd) => cmd.includes(`docker`))).toBe(false)
      expect(execCalls.some((cmd) => cmd.includes(`migrate`))).toBe(false)
    })

    it(`should handle template setup errors`, async () => {
      process.argv = [`node`, `cli.js`, `my-app`]
      mockSetupTemplate.mockRejectedValue(new Error(`Template download failed`))

      const { main } = await import(`../src/cli.js`)

      await expect(main()).rejects.toThrow(`process.exit(1)`)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Setup failed:`,
        `Template download failed`
      )
      expect(mockExecSync).not.toHaveBeenCalled()
    })

    it(`should handle non-Error thrown values`, async () => {
      process.argv = [`node`, `cli.js`, `my-app`]
      mockSetupTemplate.mockRejectedValue(`string error`)

      const { main } = await import(`../src/cli.js`)

      await expect(main()).rejects.toThrow(`process.exit(1)`)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Setup failed:`,
        `string error`
      )
    })

    it(`should display local Docker next steps after successful setup`, async () => {
      process.argv = [`node`, `cli.js`, `my-app`]
      mockSetupTemplate.mockResolvedValue(undefined)

      const { main } = await import(`../src/cli.js`)

      await main()

      const lines = consoleLogSpy.mock.calls.map((call: unknown[]) => call[0])
      const stepsStart = lines.indexOf(`Next steps:`)
      expect(stepsStart).toBeGreaterThan(-1)
      expect(lines.slice(stepsStart + 1, stepsStart + 5)).toEqual([
        `  cd my-app`,
        `  pnpm backend:up       # Start Postgres and Electric in Docker`,
        `  pnpm migrate          # Apply database migrations`,
        `  pnpm dev              # Start the dev server`,
      ])
      // pnpm install runs automatically, so it's not shown in next steps
      expect(lines).not.toContain(`  pnpm install`)
      expect(lines).toContain(`Then open https://localhost:5173`)
    })

    it(`should display available commands after successful setup`, async () => {
      process.argv = [`node`, `cli.js`, `my-app`]
      mockSetupTemplate.mockResolvedValue(undefined)

      const { main } = await import(`../src/cli.js`)

      await main()

      const lines = consoleLogSpy.mock.calls.map((call: unknown[]) => call[0])
      expect(lines).toContain(`Commands:`)
      expect(lines).toContain(`  pnpm psql             # Connect to database`)
      expect(lines).toContain(
        `  pnpm backend:down     # Stop Postgres and Electric`
      )
      expect(lines).toContain(
        `  pnpm backend:clear    # Stop them and delete their data`
      )
      expect(lines.some((line) => /claim|netlify|cloud/i.test(line))).toBe(
        false
      )
    })

    it(`should show pnpm install in next steps when install fails`, async () => {
      process.argv = [`node`, `cli.js`, `my-app`]
      mockSetupTemplate.mockResolvedValue(undefined)
      mockExecSync.mockImplementation(() => {
        throw new Error(`install failed`)
      })

      const { main } = await import(`../src/cli.js`)

      await expect(main()).rejects.toThrow(`process.exit(1)`)
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `Failed to install dependencies`
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(`  pnpm install`)
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `  pnpm backend:up       # Start Postgres and Electric in Docker`
      )
    })

    it(`should accept app names with underscores and numbers`, async () => {
      mockSetupTemplate.mockResolvedValue(undefined)
      const { main } = await import(`../src/cli.js`)

      process.argv = [`node`, `cli.js`, `my_valid_app`]
      await main()
      expect(mockSetupTemplate).toHaveBeenCalledWith(`my_valid_app`)

      process.argv = [`node`, `cli.js`, `my-app-123`]
      await main()
      expect(mockSetupTemplate).toHaveBeenCalledWith(`my-app-123`)
    })

    it(`should accept "." as app name for current directory mode`, async () => {
      process.argv = [`node`, `cli.js`, `.`]
      mockSetupTemplate.mockResolvedValue(undefined)

      const { main } = await import(`../src/cli.js`)

      await main()

      expect(mockSetupTemplate).toHaveBeenCalledWith(`.`)
      expect(mockExecSync.mock.calls[0][1]).toMatchObject({
        cwd: process.cwd(),
      })
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `Configuring current directory...`
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(`Setup complete`)
      expect(consoleLogSpy).not.toHaveBeenCalledWith(`  cd .`)
    })
  })
})
