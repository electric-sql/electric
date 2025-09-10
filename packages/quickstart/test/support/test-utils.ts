import { vi } from 'vitest'
import { spawn } from 'child_process'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * Creates a temporary directory for testing
 */
export function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), `quickstart-test-`))
}

/**
 * Cleans up a temporary directory
 */
export function cleanupTempDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Mock fetch responses for Electric API
 */
export function mockElectricApiResponses() {
  const mockFetch = vi.fn()

  // Mock successful provision response
  const mockProvisionSuccess = {
    source_id: `test-source-id`,
    secret: `test-secret`,
    DATABASE_URL: `postgresql://test:test@localhost:5432/test`,
  }

  // Mock successful claim response
  const mockClaimSuccess = {
    claimUrl: `https://electric-sql.com/claim/test-claim-url`,
  }

  mockFetch.mockImplementation((url: string) => {
    if (url.includes(`/v1/provision`)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockProvisionSuccess),
        status: 200,
        statusText: `OK`,
      })
    }

    if (url.includes(`/v1/claim`)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockClaimSuccess),
        status: 200,
        statusText: `OK`,
      })
    }

    return Promise.resolve({
      ok: false,
      status: 404,
      statusText: `Not Found`,
    })
  })

  return {
    mockFetch,
    mockProvisionSuccess,
    mockClaimSuccess,
  }
}

/**
 * Mock execSync for testing CLI commands
 */
export function mockExecSync() {
  return vi.fn().mockImplementation((command: string) => {
    if (command.includes(`gitpick`)) {
      // Simulate successful gitpick execution
      return Buffer.from(`Template downloaded successfully`)
    }
    return Buffer.from(`Command executed`)
  })
}

/**
 * Execute CLI command for testing
 */
export function execCli(args: string[]): Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
}> {
  return new Promise((resolve) => {
    const cliPath = join(__dirname, `../../dist/cli.js`)
    const child = spawn(`node`, [cliPath, ...args], {
      stdio: [`pipe`, `pipe`, `pipe`],
    })

    let stdout = ``
    let stderr = ``

    child.stdout?.on(`data`, (data) => {
      stdout += data.toString()
    })

    child.stderr?.on(`data`, (data) => {
      stderr += data.toString()
    })

    child.on(`close`, (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code,
      })
    })
  })
}
