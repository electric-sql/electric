import { spawn } from 'node:child_process'
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
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
  private disposed = false

  constructor(readonly workingDirectory: string) {}

  async exec(opts: SandboxExecOpts): Promise<SandboxExecResult> {
    this.assertLive()
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
    this.assertLive()
    const target = await this.resolveWithin(path)
    try {
      return await readFile(target)
    } catch (err) {
      throw wrapFsError(err, `readFile`, path)
    }
  }

  async writeFile(path: string, content: Buffer | string): Promise<void> {
    this.assertLive()
    const target = await this.resolveWithin(path)
    try {
      await writeFile(target, content)
    } catch (err) {
      throw wrapFsError(err, `writeFile`, path)
    }
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    this.assertLive()
    const target = await this.resolveWithin(path)
    try {
      await mkdir(target, { recursive: opts?.recursive ?? false })
    } catch (err) {
      throw wrapFsError(err, `mkdir`, path)
    }
  }

  async readdir(path: string): Promise<ReadonlyArray<DirEntry>> {
    this.assertLive()
    const target = await this.resolveWithin(path)
    try {
      const entries = await readdir(target, { withFileTypes: true })
      return entries.map((e) => ({ name: e.name, type: dirEntryType(e) }))
    } catch (err) {
      throw wrapFsError(err, `readdir`, path)
    }
  }

  async exists(path: string): Promise<boolean> {
    this.assertLive()
    let target: string
    try {
      target = await this.resolveWithin(path)
    } catch (err) {
      // Safe-probe semantics: a path denied by the workspace boundary reads
      // as "absent" rather than leaking the policy edge (matches docker /
      // remote). Non-policy failures still surface.
      if (err instanceof SandboxError && err.kind === `policy`) return false
      throw err
    }
    try {
      await stat(target)
      return true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === `ENOENT`) return false
      throw wrapFsError(err, `exists`, path)
    }
  }

  async remove(path: string, opts?: { recursive?: boolean }): Promise<void> {
    this.assertLive()
    const target = await this.resolveWithin(path)
    try {
      await rm(target, { recursive: opts?.recursive ?? false, force: false })
    } catch (err) {
      throw wrapFsError(err, `remove`, path)
    }
  }

  async stat(path: string): Promise<FileStat> {
    this.assertLive()
    const target = await this.resolveWithin(path)
    try {
      const s = await stat(target)
      return toFileStat(s)
    } catch (err) {
      throw wrapFsError(err, `stat`, path)
    }
  }

  /**
   * Resolve a user-supplied path against the working directory and verify it
   * stays inside, following symlinks. This provider shares the host
   * filesystem, so workspace containment is enforced here — the tools are
   * filesystem-agnostic and trust the sandbox to serve or reject. Defends
   * against the CVE-2025-53109/53110-shape bypass where a path looks clean
   * but a component is a symlink pointing outside the workspace.
   *
   * - For paths that already exist, returns the canonicalized realpath.
   * - For paths that don't yet exist (write/mkdir into a new file), walks up
   *   to the deepest existing ancestor, verifies its realpath is inside the
   *   workspace, and returns the canonicalized ancestor joined with the
   *   non-existing remainder — so the FS target can't be redirected by an
   *   attacker-controlled symlink mid-path.
   *
   * Throws `SandboxError('policy')` if the resolved path escapes the
   * working directory.
   */
  private async resolveWithin(userPath: string): Promise<string> {
    // The realpath walk below is the authority: it canonicalizes the
    // deepest existing ancestor (following symlinks) and checks containment
    // against the canonical workspace root, so it handles both `..` escapes
    // and symlinked components. We deliberately avoid a pure-string
    // pre-check — comparing a non-canonical absolute path against `cwdReal`
    // false-positives when the workspace sits under a symlink (e.g. macOS
    // /var → /private/var).
    const cwdReal = await realpath(this.workingDirectory)
    let probe = resolve(this.workingDirectory, userPath)
    let suffix = ``
    for (;;) {
      try {
        const real = await realpath(probe)
        const rel = relative(cwdReal, real)
        if (rel.startsWith(`..`) || rel === `..`) throw this.denied(userPath)
        // TODO(multi-tenant): when `suffix` is non-empty the returned target
        // includes not-yet-existing components, leaving a narrow TOCTOU window
        // — a concurrent writer could materialize an intermediate symlink that
        // escapes the workspace between this check and the caller's FS op. Safe
        // for this provider's single-tenant trusted-code contract (see the
        // class docstring); a multi-tenant use would need to re-validate the
        // final resolved target *after* the FS call (e.g. via O_NOFOLLOW or a
        // post-op realpath containment recheck).
        return suffix.length === 0 ? real : resolve(real, suffix)
      } catch (err) {
        if (err instanceof SandboxError) throw err
        const code = (err as NodeJS.ErrnoException).code
        if (code !== `ENOENT`) throw err
        const parent = dirname(probe)
        if (parent === probe) throw this.denied(userPath)
        suffix =
          suffix.length === 0
            ? probe.slice(parent.length + 1)
            : `${probe.slice(parent.length + 1)}/${suffix}`
        probe = parent
      }
    }
  }

  private denied(userPath: string): SandboxError {
    return new SandboxError(
      `policy`,
      `unrestrictedSandbox: access to "${userPath}" is denied (outside working directory ${this.workingDirectory}).`
    )
  }

  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    this.assertLive()
    return globalThis.fetch(input as RequestInfo, init)
  }

  async dispose(): Promise<void> {
    // No teardown to do (this provider shares the host process), but flip the
    // flag so post-dispose use throws — mirrors docker/remote and keeps the
    // cross-provider conformance invariant honest, guarding against a future
    // change that makes dispose meaningful (e.g. cancelling in-flight execs).
    this.disposed = true
  }

  private assertLive(): void {
    if (this.disposed) {
      throw new SandboxError(
        `runtime`,
        `unrestrictedSandbox: operation called after dispose().`
      )
    }
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
