/**
 * CLI Testing DSL — fluent builder for testing the electric-agents CLI binary.
 *
 * Executes CLI commands as subprocesses against a running test server,
 * asserting on stdout, stderr, and exit codes.
 *
 * Usage:
 *   await cliTest(baseUrl, cliBin)
 *     .exec('types')
 *     .expectStdout(/No entity types/)
 *     .exec('spawn', '/my-type/instance-1')
 *     .expectStdout(/Spawned/)
 *     .exec('ps')
 *     .expectStdout(/my-type/)
 *     .exec('kill', '/my-type/instance-1')
 *     .expectStdout(/Killed/)
 *     .run()
 */

import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { expect } from 'vitest'

// ============================================================================
// Types
// ============================================================================

interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

type Step =
  | { kind: `exec`; args: Array<string> }
  | { kind: `expectStdout`; pattern: RegExp }
  | { kind: `expectStdoutNot`; pattern: RegExp }
  | { kind: `expectStdoutContains`; text: string }
  | { kind: `expectStderr`; pattern: RegExp }
  | { kind: `expectExitCode`; code: number }
  | { kind: `expectJson`; check: (data: unknown) => void }
  | { kind: `custom`; fn: (last: ExecResult) => void | Promise<void> }
  | { kind: `setupType`; registration: Record<string, unknown> }
  | { kind: `setupSubscription`; pattern: string; id: string }
  | {
      kind: `verifyApi`
      fn: (baseUrl: string) => void | Promise<void>
    }
  | { kind: `wait`; ms: number }

export interface CliHistory {
  command: Array<string>
  stdout: string
  stderr: string
  exitCode: number
}

// ============================================================================
// CliScenario — Fluent builder
// ============================================================================

export class CliScenario {
  private baseUrl: string
  private cliBin: string
  private steps: Array<Step> = []

  constructor(baseUrl: string, cliBin: string) {
    this.baseUrl = baseUrl
    this.cliBin = cliBin
  }

  /**
   * Register an entity type via HTTP (setup, not a CLI test).
   */
  setupType(registration: Record<string, unknown>): this {
    this.steps.push({ kind: `setupType`, registration })
    return this
  }

  /**
   * Create a webhook subscription via HTTP (setup, not a CLI test).
   */
  setupSubscription(pattern: string, id: string): this {
    this.steps.push({ kind: `setupSubscription`, pattern, id })
    return this
  }

  /**
   * Verify internal server state via direct API call.
   * Provides an extra level of guarantee beyond CLI output.
   */
  verifyApi(fn: (baseUrl: string) => void | Promise<void>): this {
    this.steps.push({ kind: `verifyApi`, fn })
    return this
  }

  /**
   * Execute a CLI command. Args are passed directly to the binary.
   */
  exec(...args: Array<string>): this {
    this.steps.push({ kind: `exec`, args })
    return this
  }

  /**
   * Assert stdout of the last exec matches a regex.
   */
  expectStdout(pattern: RegExp): this {
    this.steps.push({ kind: `expectStdout`, pattern })
    return this
  }

  /**
   * Assert stdout of the last exec does NOT match a regex.
   */
  expectStdoutNot(pattern: RegExp): this {
    this.steps.push({ kind: `expectStdoutNot`, pattern })
    return this
  }

  /**
   * Assert stdout contains exact text.
   */
  expectStdoutContains(text: string): this {
    this.steps.push({ kind: `expectStdoutContains`, text })
    return this
  }

  /**
   * Assert stderr of the last exec matches a regex.
   */
  expectStderr(pattern: RegExp): this {
    this.steps.push({ kind: `expectStderr`, pattern })
    return this
  }

  /**
   * Assert exit code of the last exec.
   */
  expectExitCode(code: number): this {
    this.steps.push({ kind: `expectExitCode`, code })
    return this
  }

  /**
   * Parse stdout as JSON and run a check function.
   */
  expectJson(check: (data: unknown) => void): this {
    this.steps.push({ kind: `expectJson`, check })
    return this
  }

  /**
   * Custom assertion on the last exec result.
   */
  custom(fn: (last: ExecResult) => void | Promise<void>): this {
    this.steps.push({ kind: `custom`, fn })
    return this
  }

  /**
   * Wait for a given number of milliseconds.
   */
  wait(ms: number): this {
    this.steps.push({ kind: `wait`, ms })
    return this
  }

  /**
   * Run all steps sequentially, returning the history.
   */
  async run(): Promise<Array<CliHistory>> {
    const history: Array<CliHistory> = []
    let lastResult: ExecResult = { stdout: ``, stderr: ``, exitCode: 0 }

    const receiver = await startNoopReceiver()

    try {
      for (const step of this.steps) {
        switch (step.kind) {
          case `setupType`: {
            const res = await fetch(`${this.baseUrl}/_electric/entity-types`, {
              method: `POST`,
              headers: { 'content-type': `application/json` },
              body: JSON.stringify(step.registration),
            })
            expect(res.ok, `setupType failed: ${res.status}`).toBe(true)
            break
          }

          case `setupSubscription`: {
            const res = await fetch(
              `${this.baseUrl}${step.pattern}?subscription=${step.id}`,
              {
                method: `PUT`,
                headers: { 'content-type': `application/json` },
                body: JSON.stringify({ webhook: receiver.url }),
              }
            )
            expect(
              res.status,
              `setupSubscription failed: ${res.status}`
            ).toBeLessThan(300)
            break
          }

          case `verifyApi`: {
            await step.fn(this.baseUrl)
            break
          }

          case `exec`: {
            lastResult = await execCli(this.cliBin, step.args, this.baseUrl)
            history.push({
              command: step.args,
              stdout: lastResult.stdout,
              stderr: lastResult.stderr,
              exitCode: lastResult.exitCode,
            })
            break
          }

          case `expectStdout`: {
            expect(
              lastResult.stdout,
              `stdout should match ${step.pattern}`
            ).toMatch(step.pattern)
            break
          }

          case `expectStdoutNot`: {
            expect(
              lastResult.stdout,
              `stdout should NOT match ${step.pattern}`
            ).not.toMatch(step.pattern)
            break
          }

          case `expectStdoutContains`: {
            expect(
              lastResult.stdout,
              `stdout should contain "${step.text}"`
            ).toContain(step.text)
            break
          }

          case `expectStderr`: {
            expect(
              lastResult.stderr,
              `stderr should match ${step.pattern}`
            ).toMatch(step.pattern)
            break
          }

          case `expectExitCode`: {
            if (lastResult.exitCode !== step.code) {
              const detail =
                lastResult.stderr || lastResult.stdout || `(no output)`
              expect(
                lastResult.exitCode,
                `exit code should be ${step.code}, output: ${detail.slice(0, 200)}`
              ).toBe(step.code)
            }
            break
          }

          case `expectJson`: {
            const parsed = JSON.parse(lastResult.stdout)
            step.check(parsed)
            break
          }

          case `custom`: {
            await step.fn(lastResult)
            break
          }

          case `wait`: {
            await new Promise((resolve) => setTimeout(resolve, step.ms))
            break
          }
        }
      }
    } finally {
      await receiver.close()
    }

    return history
  }
}

// ============================================================================
// Helpers
// ============================================================================

function execCli(
  bin: string,
  args: Array<string>,
  baseUrl: string
): Promise<ExecResult> {
  return new Promise((resolve) => {
    // Resolve tsx from the repo root so CI does not depend on a bare `tsx`
    // binary being present on PATH.
    execFile(
      `pnpm`,
      [`exec`, `tsx`, bin, ...args],
      {
        env: {
          ...process.env,
          ELECTRIC_AGENTS_URL: baseUrl,
          ELECTRIC_AGENTS_IDENTITY: `test-user@test-host`,
        },
        timeout: 30_000,
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: error
            ? typeof error.code === `number`
              ? error.code
              : 1
            : 0,
        })
      }
    )
  })
}

// ============================================================================
// Public factory
// ============================================================================

export function cliTest(baseUrl: string, cliBin: string): CliScenario {
  return new CliScenario(baseUrl, cliBin)
}

// ============================================================================
// No-op webhook receiver
// ============================================================================

interface NoopReceiver {
  url: string
  close: () => Promise<void>
}

function startNoopReceiver(): Promise<NoopReceiver> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      _req.on(`data`, () => {})
      _req.on(`end`, () => {
        res.writeHead(200, { 'content-type': `application/json` })
        res.end(JSON.stringify({ ok: true }))
      })
    })

    server.listen(0, `127.0.0.1`, () => {
      const addr = server.address()
      if (!addr || typeof addr === `string`) {
        throw new Error(`Failed to start noop receiver`)
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res())
          }),
      })
    })
  })
}
