import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SandboxManager } from '@anthropic-ai/sandbox-runtime'
import { chooseDefaultSandbox } from '../src/sandbox/default'

/**
 * chooseDefaultSandbox(workingDirectory, env): the runtime helper that
 * picks the right Sandbox provider for built-in entities (Horton, Worker)
 * given the current process. macOS/Linux → nativeSandbox; Windows
 * (or any unsupported platform) → unrestrictedSandbox. The
 * ELECTRIC_AGENTS_UNRESTRICTED=1 env switch forces unrestrictedSandbox on
 * any platform — documented as the panic-revert path.
 */
describe(`chooseDefaultSandbox`, () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `sandbox-default-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it(`returns nativeSandbox on supported platforms`, async () => {
    if (!SandboxManager.isSupportedPlatform()) return
    const sandbox = await chooseDefaultSandbox(cwd, {})
    try {
      expect(sandbox.name).toMatch(/^native:(macos-seatbelt|linux-bwrap-only)$/)
    } finally {
      await sandbox.dispose()
    }
  })

  it(`returns unrestrictedSandbox when ELECTRIC_AGENTS_UNRESTRICTED=1`, async () => {
    const sandbox = await chooseDefaultSandbox(cwd, {
      ELECTRIC_AGENTS_UNRESTRICTED: `1`,
    })
    try {
      expect(sandbox.name).toBe(`unrestricted`)
    } finally {
      await sandbox.dispose()
    }
  })

  it(`returns unrestrictedSandbox when ELECTRIC_AGENTS_UNRESTRICTED=true (case-insensitive)`, async () => {
    const sandbox = await chooseDefaultSandbox(cwd, {
      ELECTRIC_AGENTS_UNRESTRICTED: `true`,
    })
    try {
      expect(sandbox.name).toBe(`unrestricted`)
    } finally {
      await sandbox.dispose()
    }
  })

  it(`falls back to unrestrictedSandbox on unsupported platforms`, async () => {
    // Simulate an unsupported platform by forcing the helper into the
    // fallback path via a fake SandboxManager-style probe.
    const sandbox = await chooseDefaultSandbox(
      cwd,
      {},
      {
        isNativeSupported: () => false,
      }
    )
    try {
      expect(sandbox.name).toBe(`unrestricted`)
    } finally {
      await sandbox.dispose()
    }
  })

  it(`ELECTRIC_AGENTS_UNRESTRICTED=0 does not trigger the panic switch`, async () => {
    if (!SandboxManager.isSupportedPlatform()) return
    const sandbox = await chooseDefaultSandbox(cwd, {
      ELECTRIC_AGENTS_UNRESTRICTED: `0`,
    })
    try {
      expect(sandbox.name).toMatch(/^native:/)
    } finally {
      await sandbox.dispose()
    }
  })
})
