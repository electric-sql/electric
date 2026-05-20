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
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { ProxyAgent, type Dispatcher } from 'undici'
import {
  SandboxManager,
  type SandboxRuntimeConfig,
} from '@anthropic-ai/sandbox-runtime'
import {
  SandboxError,
  type DirEntry,
  type FileStat,
  type Sandbox,
  type SandboxExecOpts,
  type SandboxExecResult,
} from './types'

export interface NativeSandboxOpts {
  workingDirectory: string
  /**
   * Hostname allowlist for outbound network. Default: deny everything.
   * Patterns are passed through to `@anthropic-ai/sandbox-runtime`'s
   * domain matcher, which supports exact match (`example.com`),
   * wildcard subdomains (`*.example.com`), and `localhost`. Per the
   * library's validator: `*.com`, bare `*`, etc. are rejected for being
   * overly broad. Both subprocess egress (via the library's HTTP/SOCKS
   * proxies) and `sandbox.fetch()` (via undici ProxyAgent routed at the
   * same proxy) obey this list.
   */
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
  // isSupportedPlatform() only checks the OS family. Runtime tools
  // (bubblewrap on Linux, sandbox-exec on macOS) may still be missing
  // from PATH. Surface that as `unavailable` so callers can skip
  // cleanly instead of crashing inside SandboxManager.initialize().
  const deps = SandboxManager.checkDependencies()
  if (deps.errors.length > 0) {
    throw new SandboxError(
      `unavailable`,
      `nativeSandbox dependency check failed: ${deps.errors.join(`; `)}`
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
  private fetchDispatcher: Dispatcher | null = null

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
        // Process group so we can kill the whole tree on timeout
        // (see comment in unrestricted.ts for the Linux pipe-orphan
        // rationale).
        detached: true,
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
      const killTree = (signal: NodeJS.Signals) => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, signal)
        } catch {
          /* already gone */
        }
      }
      if (opts.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          timedOut = true
          killTree(`SIGTERM`)
          setTimeout(() => killTree(`SIGKILL`), 500).unref()
        }, opts.timeoutMs)
      }

      const onAbort = () => {
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
        clearAbort()
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
    try {
      return await readFile(safe)
    } catch (err) {
      throw wrapFsError(err, `readFile`, path)
    }
  }

  async writeFile(path: string, content: Buffer | string): Promise<void> {
    const safe = await this.assertWritable(path)
    try {
      await writeFile(safe, content)
    } catch (err) {
      throw wrapFsError(err, `writeFile`, path)
    }
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    const safe = await this.assertWritable(path)
    try {
      await mkdir(safe, { recursive: opts?.recursive ?? false })
    } catch (err) {
      throw wrapFsError(err, `mkdir`, path)
    }
  }

  async readdir(path: string): Promise<ReadonlyArray<DirEntry>> {
    const safe = await this.assertReadable(path)
    try {
      const entries = await readdir(safe, { withFileTypes: true })
      return entries.map((e) => ({ name: e.name, type: dirEntryType(e) }))
    } catch (err) {
      throw wrapFsError(err, `readdir`, path)
    }
  }

  async exists(path: string): Promise<boolean> {
    // assertReadable enforces policy boundaries — a denied path throws
    // SandboxError('policy') here too. Missing paths return false.
    const safe = await this.assertReadable(path)
    try {
      await stat(safe)
      return true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === `ENOENT`) return false
      throw wrapFsError(err, `exists`, path)
    }
  }

  async remove(path: string, opts?: { recursive?: boolean }): Promise<void> {
    const safe = await this.assertWritable(path)
    try {
      await rm(safe, { recursive: opts?.recursive ?? false, force: false })
    } catch (err) {
      throw wrapFsError(err, `remove`, path)
    }
  }

  async stat(path: string): Promise<FileStat> {
    const safe = await this.assertReadable(path)
    try {
      const s = await stat(safe)
      return toFileStat(s)
    } catch (err) {
      throw wrapFsError(err, `stat`, path)
    }
  }

  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    // Route through the library's HTTP proxy so both subprocess (via
    // `sandbox.exec`) and host-process fetch obey the same policy. The
    // proxy enforces allowedDomains with wildcards, IP canonicalization
    // (e.g. `2852039166` → `169.254.169.254`), and deniedDomains —
    // semantics our previous TS-level Set.has check did not have.
    //
    // The proxy is only available after SandboxManager is initialized,
    // so we lazy-init here just like exec does. Init also brings up the
    // policy enforcer; without it there's no safe place to fall back to.
    await this.ensureInitialized()
    try {
      const response = await globalThis.fetch(input as RequestInfo, {
        ...init,
        // @ts-expect-error - undici dispatcher option not in std lib.dom.d.ts
        dispatcher: this.fetchDispatcher ?? undefined,
      })
      // The proxy denies via HTTP 403 with a body indicating the rejection
      // reason. Translate to SandboxError so callers can distinguish a
      // policy rejection from a genuine 403 from the target.
      if (response.status === 403 && this.fetchDispatcher) {
        const proxyDenied = response.headers.get(`x-srt-denied`)
        if (proxyDenied) {
          throw new SandboxError(
            `policy`,
            `nativeSandbox: proxy denied request (${proxyDenied})`
          )
        }
      }
      return response
    } catch (err) {
      if (err instanceof SandboxError) throw err
      // undici emits a `cause`-bearing TypeError when the proxy refuses a
      // CONNECT. Surface that as a policy error rather than letting the
      // bare network error escape — the request was rejected by our
      // sandbox config, not by the network.
      const url = typeof input === `string` ? new URL(input) : input
      throw new SandboxError(
        `policy`,
        `nativeSandbox: fetch to "${url.hostname}" was rejected by the sandbox proxy (${
          err instanceof Error ? err.message : String(err)
        })`
      )
    }
  }

  async dispose(): Promise<void> {
    if (!this.initialized) return
    this.initialized = false
    if (this.fetchDispatcher) {
      await this.fetchDispatcher.close()
      this.fetchDispatcher = null
    }
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

    // Build the fetch dispatcher *after* init so the proxy is up. On macOS
    // the library exposes a TCP port; on Linux the proxy is reachable via
    // a Unix socket. For Linux's unix-socket case we'd need a custom
    // dispatcher (TODO: undici Agent with a unix-socket connect factory);
    // for now we fall back to a `null` dispatcher on Linux, which means
    // sandbox.fetch on Linux currently goes direct rather than via the
    // proxy. exec-driven traffic on Linux still runs through the proxy.
    const port = SandboxManager.getProxyPort()
    if (port !== undefined) {
      this.fetchDispatcher = new ProxyAgent(`http://127.0.0.1:${port}`)
    }
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
    `nativeSandbox.${op}("${path}") failed: ${e.code ?? ``} ${e.message ?? String(err)}`.trim()
  )
}
