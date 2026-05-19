import { spawn } from 'node:child_process'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import {
  SandboxManager,
  type SandboxRuntimeConfig,
} from '@anthropic-ai/sandbox-runtime'
import {
  SandboxError,
  type Sandbox,
  type SandboxExecOpts,
  type SandboxExecResult,
} from './types'

export interface NativeSandboxOpts {
  workingDirectory: string
  /** Hostname allowlist for outbound network. Default: deny everything. */
  allowedHosts?: ReadonlyArray<string>
  /** Read-only paths to allow beyond the working directory base set. */
  extraReadPaths?: ReadonlyArray<string>
}

/**
 * Default deny overlay — paths inside the user's home that contain credentials
 * or tokens for common dev tools. Documented as known-incomplete (option (1)
 * in plans/sandbox-design.md §5.2); the structural fix is a curated
 * read-allowlist in v2.
 */
const DEFAULT_HOME_DENY_READS: ReadonlyArray<string> = [
  `.ssh`,
  `.aws`,
  `.config/gcloud`,
  `.config/op`,
  `.config/gh`,
  `.kube`,
  `.docker`,
  `.netrc`,
  `.npmrc`,
  `.pgpass`,
  `.huggingface`,
  `Library/Application Support`,
]

function buildDenyReadList(): Array<string> {
  const home = homedir()
  return DEFAULT_HOME_DENY_READS.map((rel) => join(home, rel))
}

const NATIVE_NAME =
  process.platform === `darwin`
    ? `native:macos-seatbelt`
    : `native:linux-bwrap-only`

/**
 * Process-global state for the underlying SandboxManager singleton. The
 * library's SandboxManager is global (proxy servers, listeners); a single
 * Node process can host one initialized configuration at a time. We
 * initialize lazily on the first `exec()` and reference-count across
 * instances sharing the same working directory. Constructions with
 * *different* working directories that arrive while an existing one is
 * active throw `SandboxError('unavailable')`.
 */
let activeRef: {
  workingDirectory: string
  count: number
} | null = null

export async function nativeSandbox(opts: NativeSandboxOpts): Promise<Sandbox> {
  if (!SandboxManager.isSupportedPlatform()) {
    throw new SandboxError(
      `unavailable`,
      `nativeSandbox is not supported on this platform (process.platform=${process.platform}). Use unrestrictedSandbox or remoteSandbox.`
    )
  }

  const workingDirectoryReal = await realpath(opts.workingDirectory)

  if (activeRef && activeRef.workingDirectory !== workingDirectoryReal) {
    throw new SandboxError(
      `unavailable`,
      `nativeSandbox is single-instance per Node process; an existing instance is active for workingDirectory=${activeRef.workingDirectory}. Dispose it first or use a separate Node process.`
    )
  }

  return new NativeSandbox(
    workingDirectoryReal,
    new Set(buildDenyReadList()),
    opts.extraReadPaths ?? [],
    new Set(opts.allowedHosts ?? [])
  )
}

class NativeSandbox implements Sandbox {
  readonly name = NATIVE_NAME
  private initialized = false

  constructor(
    readonly workingDirectory: string,
    private readonly denyReads: ReadonlySet<string>,
    private readonly extraReadPaths: ReadonlyArray<string>,
    private readonly allowedHosts: ReadonlySet<string>
  ) {}

  async exec(opts: SandboxExecOpts): Promise<SandboxExecResult> {
    await this.ensureInitialized()
    const cwd = opts.cwd ?? this.workingDirectory
    const wrapped = await SandboxManager.wrapWithSandbox(opts.command)
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      LANG: process.env.LANG,
      TERM: process.env.TERM,
      ...opts.env,
    }
    const max = opts.maxOutputBytes ?? Number.POSITIVE_INFINITY

    return new Promise((res) => {
      const child = spawn(wrapped, {
        cwd,
        env,
        shell: true,
        stdio: [opts.stdin === undefined ? `ignore` : `pipe`, `pipe`, `pipe`],
      })

      const stdoutChunks: Array<Buffer> = []
      const stderrChunks: Array<Buffer> = []
      let stdoutBytes = 0
      let stderrBytes = 0
      let truncated = false

      const collect =
        (
          target: Array<Buffer>,
          getBytes: () => number,
          setBytes: (n: number) => void
        ) =>
        (chunk: Buffer) => {
          const bytes = getBytes()
          if (bytes >= max) {
            truncated = true
            return
          }
          const remaining = max - bytes
          if (chunk.length > remaining) {
            target.push(chunk.subarray(0, remaining))
            setBytes(bytes + remaining)
            truncated = true
          } else {
            target.push(chunk)
            setBytes(bytes + chunk.length)
          }
        }

      child.stdout?.on(
        `data`,
        collect(
          stdoutChunks,
          () => stdoutBytes,
          (n) => {
            stdoutBytes = n
          }
        )
      )
      child.stderr?.on(
        `data`,
        collect(
          stderrChunks,
          () => stderrBytes,
          (n) => {
            stderrBytes = n
          }
        )
      )

      if (opts.stdin !== undefined) child.stdin?.end(opts.stdin)

      let timer: NodeJS.Timeout | undefined
      let timedOut = false
      if (opts.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          timedOut = true
          child.kill(`SIGTERM`)
        }, opts.timeoutMs)
      }

      child.on(`error`, (err) => {
        if (timer) clearTimeout(timer)
        res({
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
        res({
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
    const safe = await this.assertReadable(path)
    return readFile(safe)
  }

  async writeFile(path: string, content: Buffer | string): Promise<void> {
    const safe = await this.assertWritable(path)
    await writeFile(safe, content)
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    const safe = await this.assertWritable(path)
    await mkdir(safe, { recursive: opts?.recursive ?? false })
  }

  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === `string` ? new URL(input) : input
    if (!this.allowedHosts.has(url.hostname)) {
      throw new SandboxError(
        `policy`,
        `nativeSandbox: host "${url.hostname}" is not in allowedHosts`
      )
    }
    return globalThis.fetch(input as RequestInfo, init)
  }

  async dispose(): Promise<void> {
    if (!this.initialized) return
    this.initialized = false
    if (!activeRef) return
    activeRef.count -= 1
    if (activeRef.count <= 0) {
      activeRef = null
      await SandboxManager.reset()
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    if (activeRef && activeRef.workingDirectory !== this.workingDirectory) {
      throw new SandboxError(
        `unavailable`,
        `nativeSandbox is single-instance per Node process; another instance is active for workingDirectory=${activeRef.workingDirectory}.`
      )
    }
    if (!activeRef) {
      const config: SandboxRuntimeConfig = {
        filesystem: {
          allowWrite: [this.workingDirectory],
          denyWrite: [],
          denyRead: [...this.denyReads],
          allowRead: [],
        },
        network: {
          allowedDomains: [...this.allowedHosts],
          deniedDomains: [],
        },
      }
      await SandboxManager.initialize(config)
      activeRef = { workingDirectory: this.workingDirectory, count: 0 }
    }
    activeRef.count += 1
    this.initialized = true
  }

  private async assertReadable(path: string): Promise<string> {
    const absolute = await this.canonicalize(path)
    const rel = relative(this.workingDirectory, absolute)
    if (!rel.startsWith(`..`) && rel !== `..`) return absolute

    for (const denied of this.denyReads) {
      const d = relative(denied, absolute)
      if (!d.startsWith(`..`) && d !== `..`) {
        throw new SandboxError(
          `policy`,
          `nativeSandbox: read access to "${path}" is denied by the default deny overlay`
        )
      }
    }
    for (const extra of this.extraReadPaths) {
      const e = relative(extra, absolute)
      if (!e.startsWith(`..`) && e !== `..`) return absolute
    }
    throw new SandboxError(
      `policy`,
      `nativeSandbox: read access to "${path}" is not granted (outside working directory and extraReadPaths)`
    )
  }

  private async assertWritable(path: string): Promise<string> {
    const absolute = await this.canonicalize(path)
    const rel = relative(this.workingDirectory, absolute)
    if (rel.startsWith(`..`) || rel === `..`) {
      throw new SandboxError(
        `policy`,
        `nativeSandbox: write access to "${path}" is denied (outside working directory)`
      )
    }
    return absolute
  }

  private async canonicalize(path: string): Promise<string> {
    const resolved = resolve(this.workingDirectory, path)
    let probe = resolved
    let suffix = ``
    for (;;) {
      try {
        const real = await realpath(probe)
        return suffix.length === 0 ? real : resolve(real, suffix)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code !== `ENOENT`) throw err
        const parent = dirname(probe)
        if (parent === probe) return resolved
        suffix =
          suffix.length === 0
            ? probe.slice(parent.length + 1)
            : `${probe.slice(parent.length + 1)}/${suffix}`
        probe = parent
      }
    }
  }
}
