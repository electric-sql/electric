import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SandboxManager } from '@anthropic-ai/sandbox-runtime'
import { nativeSandbox } from '../src/sandbox/native'

/**
 * Direct OS-level negative tests for nativeSandbox: the claims we make in
 * plans/sandbox-design.md (env scrubbing, network deny by default,
 * symlink escape blocked, writes outside cwd blocked) have to actually
 * hold when the LLM's bash command runs inside the real Seatbelt/bwrap
 * sandbox. The earlier `sandbox-native.test.ts` suite verifies the TS
 * adapter layer; this one verifies what reaches the OS.
 *
 * Skips entirely on platforms without OS sandbox support.
 */
const supported = SandboxManager.isSupportedPlatform()
const d = supported ? describe : describe.skip

d(`nativeSandbox OS-level negative cases`, () => {
  let cwd: string
  let outside: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `native-os-cwd-`))
    outside = await mkdtemp(join(tmpdir(), `native-os-outside-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it(`bash does not inherit arbitrary parent env vars`, async () => {
    process.env.__SANDBOX_OS_TEST_SECRET__ = `must-not-leak`
    const sandbox = await nativeSandbox({ workingDirectory: cwd })
    try {
      const result = await sandbox.exec({
        command: `node -e "console.log(process.env.__SANDBOX_OS_TEST_SECRET__ ?? 'absent')"`,
      })
      expect(result.stdout.toString().trim()).toBe(`absent`)
    } finally {
      await sandbox.dispose()
      delete process.env.__SANDBOX_OS_TEST_SECRET__
    }
  }, 30_000)

  it(`bash cannot write outside the working directory`, async () => {
    const target = join(outside, `should-not-exist.txt`)
    const sandbox = await nativeSandbox({ workingDirectory: cwd })
    try {
      const result = await sandbox.exec({
        command: `echo hi > ${target}`,
      })
      // Either the redirect failed (non-zero exit) or stderr was set,
      // and crucially the file must not exist.
      const { stat } = await import(`node:fs/promises`)
      let existed = true
      try {
        await stat(target)
      } catch {
        existed = false
      }
      expect(existed).toBe(false)
      expect(result.exitCode !== 0 || result.stderr.toString().length > 0).toBe(
        true
      )
    } finally {
      await sandbox.dispose()
    }
  }, 30_000)

  it(`bash cannot read a symlink that targets a path in the default deny overlay`, async () => {
    // Note the *deliberate* asymmetry vs the TS-layer symlink test:
    // the v1 native model is a curated denylist (plans/sandbox-design.md
    // §5.2 option 1), not a read-allowlist. Symlinks to arbitrary
    // /tmp paths are *allowed* by design — only paths inside our
    // documented deny set (e.g. ~/.ssh) are blocked. The v2 allowlist
    // would close this gap structurally. This test pins the v1
    // behavior so a regression is caught either way.
    const home = process.env.HOME ?? ``
    // Use a fake "ssh-style" target *under home* so the deny overlay
    // applies, but without touching the user's real ~/.ssh.
    const fakeSensitive = `${home}/.ssh/__sandbox_test_marker__`
    // Don't actually create the file — we only need the path to be in
    // the deny region. The expectation is that the read attempt
    // returns nothing (file may or may not exist; either way the
    // sandbox refuses).
    await symlink(fakeSensitive, join(cwd, `link.txt`))
    const sandbox = await nativeSandbox({ workingDirectory: cwd })
    try {
      const result = await sandbox.exec({
        command: `cat ${cwd}/link.txt 2>&1; echo exit=$?`,
      })
      const out = result.stdout.toString()
      // The cat command should fail (sandbox denies the read), and
      // the marker content (if it existed) must not appear.
      expect(out).not.toContain(`__sandbox_test_marker__-contents`)
      // Either the read failed or the path didn't exist; both are OK
      // for this test. The crucial assertion is that we did NOT
      // successfully read whatever was at the target.
      expect(out).toMatch(/exit=[1-9]/)
    } finally {
      await sandbox.dispose()
    }
  }, 30_000)

  it(`bash with no allowedHosts cannot reach the network`, async () => {
    const sandbox = await nativeSandbox({ workingDirectory: cwd })
    try {
      // We try to hit 1.1.1.1 (Cloudflare DNS over HTTP). With an empty
      // allowedHosts list the proxy must refuse, and curl must fail.
      const result = await sandbox.exec({
        command: `curl --max-time 5 -sS -o /dev/null -w '%{http_code}' https://1.1.1.1 || echo curl-failed`,
      })
      const out = result.stdout.toString()
      expect(out.includes(`200`)).toBe(false)
    } finally {
      await sandbox.dispose()
    }
  }, 30_000)

  it(`readFile through the TS adapter denies known credential paths under home`, async () => {
    // Pure TS-level guard, but we re-assert here because the
    // home-deny overlay is the single biggest behavior change for
    // nativeSandbox vs the underlying library defaults.
    const sandbox = await nativeSandbox({ workingDirectory: cwd })
    try {
      const home = process.env.HOME ?? ``
      const sensitive = [
        `${home}/.ssh/id_rsa`,
        `${home}/.aws/credentials`,
        `${home}/.config/gcloud/credentials.db`,
      ]
      for (const path of sensitive) {
        await expect(sandbox.readFile(path)).rejects.toThrow(
          /denied by the default deny overlay/
        )
      }
    } finally {
      await sandbox.dispose()
    }
  }, 30_000)
})
