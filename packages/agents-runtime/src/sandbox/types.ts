/**
 * Sandbox primitive — isolates filesystem, process, and network operations
 * performed by LLM-driven tools. See plans/sandbox-design.md for the design
 * doc; §10 for what this primitive does NOT protect against.
 */

export interface Sandbox {
  /**
   * Machine-readable identifier for the active provider. Makes the
   * isolation strength legible in logs (e.g. `native:linux-bwrap-only` so
   * reviewers see the limitation).
   */
  readonly name: string

  /**
   * Absolute path of the sandbox's primary writable root. Tools use this
   * to format cwd-relative messages and to resolve relative paths before
   * calling FS methods.
   */
  readonly workingDirectory: string

  exec(opts: SandboxExecOpts): Promise<SandboxExecResult>

  readFile(path: string): Promise<Buffer>
  writeFile(path: string, content: Buffer | string): Promise<void>
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>
  /**
   * List entries in a directory. Order is not guaranteed; callers that
   * need a stable order should sort by `name`.
   */
  readdir(path: string): Promise<ReadonlyArray<DirEntry>>
  /**
   * Returns true iff the path exists and is reachable. As a safe-probe
   * primitive, returns `false` both for missing paths and for paths denied
   * by the sandbox's read policy — callers should treat `exists` as
   * least-info and not use it to detect policy boundaries. (Matches the
   * Vercel/Cloudflare/E2B LCD semantics.)
   */
  exists(path: string): Promise<boolean>
  /** Remove a file or (when `recursive: true`) a directory tree. */
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>
  /** Metadata for an entry. Rejects with `SandboxError('runtime')` if missing. */
  stat(path: string): Promise<FileStat>

  fetch(input: string | URL, init?: RequestInit): Promise<Response>

  /**
   * URL the caller can hit (from the host process) to reach a server the
   * sandboxed code has bound to `port`. For host-process providers
   * (unrestricted/native) this is just a loopback URL; for remote / Docker
   * providers it's the externally-reachable mapping. Providers that cannot
   * publish ports reject with `SandboxError('unavailable')`.
   */
  getUrl(opts: { port: number; protocol?: `http` | `https` }): Promise<string>

  /**
   * Replace the outbound network policy mid-session. Providers that cannot
   * reconfigure egress without recreating the sandbox reject with
   * `SandboxError('unavailable')`; providers with TS-side enforcement only
   * (e.g. remote with no VM-side egress controls) may update their local
   * allowlist while logging a one-time warning that egress *from inside*
   * the workspace is not affected.
   */
  updateNetworkPolicy(policy: NetworkPolicy): Promise<void>

  /**
   * Terminal teardown. Provider implementations may map this to a
   * state-preserving call (pause/stop/snapshot/hibernate/suspend)
   * provided the next factory invocation can transparently reattach
   * using `entityUrl` alone. Not idempotent.
   */
  dispose(): Promise<void>
}

/**
 * Factory invoked by the runtime at the start of each wake-session to
 * construct `ctx.sandbox`. Closures may hold caches as in-process
 * optimizations, but correctness must not depend on the cache
 * surviving a host cold start — provider-side identity must be
 * derivable from `entityUrl` alone (deterministic name, label, etc.)
 * so a wake delivered to a freshly cold-started ephemeral host
 * (Cloudflare Workers, Lambda) can still reattach to the warm
 * provider-side sandbox.
 */
export interface SandboxFactoryParams {
  entityUrl: string
  entityType: string
  args: Readonly<Record<string, unknown>>
}

export type SandboxFactory = (params: SandboxFactoryParams) => Promise<Sandbox>

export type NetworkPolicy =
  | { mode: `allow-all` }
  | { mode: `deny-all` }
  | { mode: `allowlist`; allow: ReadonlyArray<string> }

export interface SandboxExecOpts {
  /** Shell command line. Sandbox decides how to run it (typically `sh -c`). */
  command: string
  /** Defaults to the sandbox's configured working directory. */
  cwd?: string
  /** Env merged onto the sandbox's allowed-env base. */
  env?: Record<string, string>
  /** Wall-clock timeout. Default is provider-specific. */
  timeoutMs?: number
  stdin?: Buffer | string
  /** Truncate combined stdout+stderr to this many bytes per stream. */
  maxOutputBytes?: number
  /**
   * External cancellation signal. When aborted, the running command is
   * terminated (same escalation as `timeoutMs`) and the result has
   * `timedOut: false` with `signal` set to the signal used. First of
   * `signal` or `timeoutMs` to fire wins.
   */
  signal?: AbortSignal
}

export interface DirEntry {
  name: string
  type: `file` | `directory` | `symlink` | `other`
}

export interface FileStat {
  type: `file` | `directory` | `symlink` | `other`
  size: number
  mtimeMs: number
}

export interface SandboxExecResult {
  exitCode: number | null
  signal: string | null
  stdout: Buffer
  stderr: Buffer
  timedOut: boolean
  /**
   * True iff the command was terminated because the caller's
   * `SandboxExecOpts.signal` fired. Distinct from `timedOut` (timeoutMs
   * elapsed) and from a naturally-delivered `signal` field.
   */
  aborted: boolean
  outputTruncated: boolean
}

export type SandboxErrorKind = `policy` | `runtime` | `unavailable`

export class SandboxError extends Error {
  readonly kind: SandboxErrorKind
  constructor(kind: SandboxErrorKind, message: string) {
    super(message)
    this.name = `SandboxError`
    this.kind = kind
  }
}
