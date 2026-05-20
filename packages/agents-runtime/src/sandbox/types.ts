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

  /** Call once at end of lifetime. Not idempotent. */
  dispose(): Promise<void>
}

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
