import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock child_process
vi.mock(`child_process`, () => ({
  execSync: vi.fn(),
}))

// Mock crypto
vi.mock(`crypto`, () => ({
  randomBytes: vi.fn(() => ({
    toString: () => `mock-random-secret-0123456789abcdef0123456789abcdef`,
  })),
}))

// Mock fs
vi.mock(`fs`, () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}))

describe(`template-setup`, () => {
  const mockCredentials = {
    source_id: `test-source-id`,
    secret: `test-secret`,
    DATABASE_URL: `postgresql://test:test@localhost:5432/test`,
    claimId: `test-claim-id`,
  }

  let mockExecSync: ReturnType<typeof vi.fn>
  let mockWriteFileSync: ReturnType<typeof vi.fn>
  let mockReadFileSync: ReturnType<typeof vi.fn>
  let mockExistsSync: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()

    const childProcess = await import(`child_process`)
    const fs = await import(`fs`)

    mockExecSync = childProcess.execSync as unknown as ReturnType<typeof vi.fn>
    mockWriteFileSync = fs.writeFileSync as unknown as ReturnType<typeof vi.fn>
    mockReadFileSync = fs.readFileSync as unknown as ReturnType<typeof vi.fn>
    mockExistsSync = fs.existsSync as unknown as ReturnType<typeof vi.fn>
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe(`setupTemplate`, () => {
    it(`should pull template using gitpick`, async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(`{}`)

      const { setupTemplate } = await import(`../src/template-setup.js`)
      await setupTemplate(`my-app`, mockCredentials)

      expect(mockExecSync).toHaveBeenCalledWith(
        `npx gitpick electric-sql/electric/tree/main/examples/tanstack-db-web-starter my-app`,
        { stdio: `inherit` }
      )
    })

    it(`should generate .env file with credentials`, async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(`{}`)

      const { setupTemplate } = await import(`../src/template-setup.js`)
      await setupTemplate(`my-app`, mockCredentials)

      // Find the .env write call
      const envWriteCall = mockWriteFileSync.mock.calls.find(
        (call: unknown[]) => (call[0] as string).endsWith(`.env`)
      )

      expect(envWriteCall).toBeDefined()
      const envContent = envWriteCall![1] as string
      expect(envContent).toContain(
        `DATABASE_URL=${mockCredentials.DATABASE_URL}`
      )
      expect(envContent).toContain(`ELECTRIC_SECRET=${mockCredentials.secret}`)
      expect(envContent).toContain(
        `ELECTRIC_SOURCE_ID=${mockCredentials.source_id}`
      )
      expect(envContent).toMatch(/ELECTRIC_URL=https?:\/\//)
      expect(envContent).toContain(`BETTER_AUTH_SECRET=`)
      expect(envContent).toContain(`DO NOT COMMIT THIS FILE`)
    })

    it(`should update .gitignore to include .env`, async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.endsWith(`.gitignore`)) return true
        if (path.endsWith(`package.json`)) return true
        if (path.endsWith(`tsconfig.json`)) return true
        return false
      })
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.endsWith(`.gitignore`)) return `node_modules\n`
        if (path.endsWith(`package.json`)) return `{"scripts":{}}`
        return ``
      })

      const { setupTemplate } = await import(`../src/template-setup.js`)
      await setupTemplate(`my-app`, mockCredentials)

      const gitignoreWriteCall = mockWriteFileSync.mock.calls.find(
        (call: unknown[]) => (call[0] as string).endsWith(`.gitignore`)
      )

      expect(gitignoreWriteCall).toBeDefined()
      const gitignoreContent = gitignoreWriteCall![1] as string
      expect(gitignoreContent).toContain(`.env`)
    })

    it(`should not duplicate .env in .gitignore if already present`, async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.endsWith(`.gitignore`)) return `node_modules\n.env\n`
        if (path.endsWith(`package.json`)) return `{"scripts":{}}`
        return ``
      })

      const { setupTemplate } = await import(`../src/template-setup.js`)
      await setupTemplate(`my-app`, mockCredentials)

      const gitignoreWriteCall = mockWriteFileSync.mock.calls.find(
        (call: unknown[]) => (call[0] as string).endsWith(`.gitignore`)
      )

      // Should not write to .gitignore since .env is already present
      expect(gitignoreWriteCall).toBeUndefined()
    })

    it(`should patch package.json with Electric scripts`, async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.endsWith(`package.json`)) {
          return JSON.stringify({
            name: `my-app`,
            scripts: {
              dev: `vinxi dev`,
              build: `vinxi build`,
            },
          })
        }
        if (path.endsWith(`.gitignore`)) return `.env\n`
        return ``
      })

      const { setupTemplate } = await import(`../src/template-setup.js`)
      await setupTemplate(`my-app`, mockCredentials)

      const packageJsonWriteCall = mockWriteFileSync.mock.calls.find(
        (call: unknown[]) => (call[0] as string).endsWith(`package.json`)
      )

      expect(packageJsonWriteCall).toBeDefined()
      const packageJson = JSON.parse(packageJsonWriteCall![1] as string)

      // Electric-specific commands
      expect(packageJson.scripts).toHaveProperty(`claim`)
      expect(packageJson.scripts).toHaveProperty(`deploy:netlify`)

      expect(packageJson.scripts.build).toBe(`vinxi build`)
    })

    it(`should not overwrite existing tsconfig.json`, async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.endsWith(`package.json`)) return `{"scripts":{}}`
        if (path.endsWith(`.gitignore`)) return `.env\n`
        return ``
      })

      const { setupTemplate } = await import(`../src/template-setup.js`)
      await setupTemplate(`my-app`, mockCredentials)

      const tsconfigWriteCall = mockWriteFileSync.mock.calls.find(
        (call: unknown[]) => (call[0] as string).endsWith(`tsconfig.json`)
      )

      // Should not write tsconfig if it exists
      expect(tsconfigWriteCall).toBeUndefined()
    })

    it(`should throw error when gitpick fails`, async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error(`gitpick failed`)
      })

      const { setupTemplate } = await import(`../src/template-setup.js`)

      await expect(setupTemplate(`my-app`, mockCredentials)).rejects.toThrow(
        `Template setup failed: gitpick failed`
      )
    })

    it(`should handle missing package.json gracefully`, async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.endsWith(`package.json`)) return false
        if (path.endsWith(`.gitignore`)) return true
        if (path.endsWith(`tsconfig.json`)) return true
        return false
      })
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.endsWith(`.gitignore`)) return `.env\n`
        return ``
      })

      const { setupTemplate } = await import(`../src/template-setup.js`)

      // Should not throw - just skip package.json patching
      await expect(
        setupTemplate(`my-app`, mockCredentials)
      ).resolves.toBeUndefined()

      // Verify package.json was not written
      const packageJsonWriteCall = mockWriteFileSync.mock.calls.find(
        (call: unknown[]) => (call[0] as string).endsWith(`package.json`)
      )
      expect(packageJsonWriteCall).toBeUndefined()
    })

    it(`should skip gitpick when appName is "."`, async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.endsWith(`package.json`)) return `{"scripts":{}}`
        if (path.endsWith(`.gitignore`)) return `.env\n`
        return ``
      })

      const { setupTemplate } = await import(`../src/template-setup.js`)
      await setupTemplate(`.`, mockCredentials)

      // gitpick should NOT be called
      expect(mockExecSync).not.toHaveBeenCalled()
    })

    it(`should use current directory when appName is "."`, async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.endsWith(`package.json`)) return `{"scripts":{}}`
        if (path.endsWith(`.gitignore`)) return `.env\n`
        return ``
      })

      const { setupTemplate } = await import(`../src/template-setup.js`)
      await setupTemplate(`.`, mockCredentials)

      // .env should be written to current directory (not a subdirectory)
      const envWriteCall = mockWriteFileSync.mock.calls.find(
        (call: unknown[]) => (call[0] as string).endsWith(`.env`)
      )
      expect(envWriteCall).toBeDefined()
      // Path should be process.cwd()/.env, not process.cwd()/./.env
      expect(envWriteCall![0]).not.toContain(`/./.env`)
    })

    it(`should still generate .env and patch package.json when appName is "."`, async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.endsWith(`package.json`)) {
          return JSON.stringify({
            name: `existing-app`,
            scripts: { dev: `vite dev` },
          })
        }
        if (path.endsWith(`.gitignore`)) return `.env\n`
        return ``
      })

      const { setupTemplate } = await import(`../src/template-setup.js`)
      await setupTemplate(`.`, mockCredentials)

      // .env should be generated
      const envWriteCall = mockWriteFileSync.mock.calls.find(
        (call: unknown[]) => (call[0] as string).endsWith(`.env`)
      )
      expect(envWriteCall).toBeDefined()
      expect(envWriteCall![1]).toContain(`DATABASE_URL=`)

      // package.json should be patched
      const packageJsonWriteCall = mockWriteFileSync.mock.calls.find(
        (call: unknown[]) => (call[0] as string).endsWith(`package.json`)
      )
      expect(packageJsonWriteCall).toBeDefined()
      const packageJson = JSON.parse(packageJsonWriteCall![1] as string)
      expect(packageJson.scripts).toHaveProperty(`claim`)
      expect(packageJson.scripts).toHaveProperty(`deploy:netlify`)
    })
  })
})
