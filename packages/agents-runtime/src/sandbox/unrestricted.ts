import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { Sandbox, SandboxExecOpts, SandboxExecResult } from './types'

export interface UnrestrictedSandboxOpts {
  workingDirectory: string
}

export function unrestrictedSandbox(
  opts: UnrestrictedSandboxOpts
): Promise<Sandbox> {
  return Promise.resolve(new UnrestrictedSandbox(opts.workingDirectory))
}

class UnrestrictedSandbox implements Sandbox {
  readonly name = `unrestricted`

  constructor(readonly workingDirectory: string) {}

  exec(opts: SandboxExecOpts): Promise<SandboxExecResult> {
    const cwd = opts.cwd ?? this.workingDirectory
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      LANG: process.env.LANG,
      TERM: process.env.TERM,
      ...opts.env,
    }
    const max = opts.maxOutputBytes ?? Number.POSITIVE_INFINITY

    return new Promise((resolve) => {
      const child = spawn(`sh`, [`-c`, opts.command], {
        cwd,
        env,
        stdio: [opts.stdin === undefined ? `ignore` : `pipe`, `pipe`, `pipe`],
        // Run in a new process group so we can signal the whole tree on
        // timeout. Linux's default `child.kill('SIGTERM')` signals only
        // the immediate child (sh), leaving grandchildren (like `sleep`)
        // orphaned with the stdio pipes still held — the `close` event
        // then doesn't fire until the grandchild exits naturally.
        detached: true,
      })

      const stdoutChunks: Array<Buffer> = []
      const stderrChunks: Array<Buffer> = []
      let stdoutBytes = 0
      let stderrBytes = 0
      let truncated = false

      child.stdout?.on(`data`, (chunk: Buffer) => {
        if (stdoutBytes >= max) {
          truncated = true
          return
        }
        const remaining = max - stdoutBytes
        if (chunk.length > remaining) {
          stdoutChunks.push(chunk.subarray(0, remaining))
          stdoutBytes += remaining
          truncated = true
        } else {
          stdoutChunks.push(chunk)
          stdoutBytes += chunk.length
        }
      })
      child.stderr?.on(`data`, (chunk: Buffer) => {
        if (stderrBytes >= max) {
          truncated = true
          return
        }
        const remaining = max - stderrBytes
        if (chunk.length > remaining) {
          stderrChunks.push(chunk.subarray(0, remaining))
          stderrBytes += remaining
          truncated = true
        } else {
          stderrChunks.push(chunk)
          stderrBytes += chunk.length
        }
      })

      if (opts.stdin !== undefined) {
        child.stdin?.end(opts.stdin)
      }

      let timer: NodeJS.Timeout | undefined
      let timedOut = false
      const killTree = (signal: NodeJS.Signals) => {
        // Negative PID signals the entire process group. We created the
        // group via `detached: true` above.
        try {
          if (child.pid !== undefined) process.kill(-child.pid, signal)
        } catch {
          // Process group may already be gone; ignore.
        }
      }
      if (opts.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          timedOut = true
          killTree(`SIGTERM`)
          // Escalate to SIGKILL if the tree doesn't die in 500ms.
          setTimeout(() => killTree(`SIGKILL`), 500).unref()
        }, opts.timeoutMs)
      }

      child.on(`error`, (err) => {
        if (timer) clearTimeout(timer)
        resolve({
          exitCode: null,
          signal: null,
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.from(err.message),
          timedOut,
          outputTruncated: truncated,
        })
      })

      child.on(`close`, (code, signal) => {
        if (timer) clearTimeout(timer)
        resolve({
          exitCode: code,
          signal,
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks),
          timedOut,
          outputTruncated: truncated,
        })
      })
    })
  }

  async readFile(path: string): Promise<Buffer> {
    return readFile(path)
  }

  async writeFile(path: string, content: Buffer | string): Promise<void> {
    await writeFile(path, content)
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    await mkdir(path, { recursive: opts?.recursive ?? false })
  }

  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    return globalThis.fetch(input as RequestInfo, init)
  }

  async dispose(): Promise<void> {
    // No-op.
  }
}
