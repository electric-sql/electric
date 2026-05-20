import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import {
  SandboxError,
  type DirEntry,
  type FileStat,
  type Sandbox,
  type SandboxExecOpts,
  type SandboxExecResult,
} from './types'

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
      let aborted = false
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

      const onAbort = () => {
        aborted = true
        killTree(`SIGTERM`)
        setTimeout(() => killTree(`SIGKILL`), 500).unref()
      }
      if (opts.signal) {
        if (opts.signal.aborted) onAbort()
        else opts.signal.addEventListener(`abort`, onAbort, { once: true })
      }
      const clearAbort = () => {
        if (opts.signal) opts.signal.removeEventListener(`abort`, onAbort)
      }

      child.on(`error`, (err) => {
        if (timer) clearTimeout(timer)
        clearAbort()
        resolve({
          exitCode: null,
          signal: null,
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.from(err.message),
          timedOut,
          aborted,
          outputTruncated: truncated,
        })
      })

      child.on(`close`, (code, signal) => {
        if (timer) clearTimeout(timer)
        clearAbort()
        resolve({
          exitCode: code,
          signal,
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks),
          timedOut,
          aborted,
          outputTruncated: truncated,
        })
      })
    })
  }

  async readFile(path: string): Promise<Buffer> {
    try {
      return await readFile(path)
    } catch (err) {
      throw wrapFsError(err, `readFile`, path)
    }
  }

  async writeFile(path: string, content: Buffer | string): Promise<void> {
    try {
      await writeFile(path, content)
    } catch (err) {
      throw wrapFsError(err, `writeFile`, path)
    }
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    try {
      await mkdir(path, { recursive: opts?.recursive ?? false })
    } catch (err) {
      throw wrapFsError(err, `mkdir`, path)
    }
  }

  async readdir(path: string): Promise<ReadonlyArray<DirEntry>> {
    try {
      const entries = await readdir(path, { withFileTypes: true })
      return entries.map((e) => ({ name: e.name, type: dirEntryType(e) }))
    } catch (err) {
      throw wrapFsError(err, `readdir`, path)
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(path)
      return true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === `ENOENT`) return false
      throw wrapFsError(err, `exists`, path)
    }
  }

  async remove(path: string, opts?: { recursive?: boolean }): Promise<void> {
    try {
      await rm(path, { recursive: opts?.recursive ?? false, force: false })
    } catch (err) {
      throw wrapFsError(err, `remove`, path)
    }
  }

  async stat(path: string): Promise<FileStat> {
    try {
      const s = await stat(path)
      return toFileStat(s)
    } catch (err) {
      throw wrapFsError(err, `stat`, path)
    }
  }

  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    return globalThis.fetch(input as RequestInfo, init)
  }

  async dispose(): Promise<void> {
    // No-op.
  }
}

function dirEntryType(e: {
  isDirectory(): boolean
  isFile(): boolean
  isSymbolicLink(): boolean
}): DirEntry[`type`] {
  if (e.isSymbolicLink()) return `symlink`
  if (e.isDirectory()) return `directory`
  if (e.isFile()) return `file`
  return `other`
}

function toFileStat(s: {
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
  size: number
  mtimeMs: number
}): FileStat {
  let type: FileStat[`type`] = `other`
  if (s.isSymbolicLink()) type = `symlink`
  else if (s.isDirectory()) type = `directory`
  else if (s.isFile()) type = `file`
  return { type, size: s.size, mtimeMs: s.mtimeMs }
}

function wrapFsError(err: unknown, op: string, path: string): Error {
  if (err instanceof SandboxError) return err
  const e = err as NodeJS.ErrnoException
  return new SandboxError(
    `runtime`,
    `unrestrictedSandbox.${op}("${path}") failed: ${e.code ?? ``} ${e.message ?? String(err)}`.trim()
  )
}
