/**
 * Sandbox primitive — isolates filesystem, process, and network operations
 * performed by LLM-driven tools. Isolation strength varies by provider;
 * each provider documents what it does and does not protect against.
 */

/**
 * Stable list of bundled adapter names. The conformance test suite asserts the
 * set of providers it exercises equals this list, so adding a new adapter
 * without registering it in the conformance suite fails CI.
 */
export const KNOWN_ADAPTERS = [`unrestricted`, `remote`, `docker`] as const
export type KnownAdapter = (typeof KNOWN_ADAPTERS)[number]

export interface Sandbox {
  /**
   * Provider identifier, for logs/legibility only — NOT a capability
   * discriminator. Built-ins use a `KnownAdapter`, optionally with a
   * provider-specific suffix (e.g. `docker:runc`); custom providers may use any
   * string. Callers must not branch on this: pass paths/requests straight
   * through and trust the sandbox to serve or reject.
   */
  readonly name: KnownAdapter | (string & {})

  /**
   * Absolute path of the sandbox's primary writable root. The sandbox
   * resolves relative paths passed to FS methods against this; callers use
   * it only to format cwd-relative messages — they do not pre-resolve or
   * pre-validate paths (that's the sandbox's job; see below).
   */
  readonly workingDirectory: string

  exec(opts: SandboxExecOpts): Promise<SandboxExecResult>

  /**
   * FS methods own path resolution and containment, enforced against the
   * filesystem the provider actually owns. A relative `path` resolves
   * against `workingDirectory`. Callers pass user paths straight through and
   * trust the sandbox to serve or reject — they must not stat/realpath in the
   * host process, which would target the wrong filesystem.
   *
   * Containment is provider-dependent, so it is documented per concern
   * rather than promised uniformly:
   * - WRITES (`writeFile`, `mkdir`, `remove`) are contained on every
   *   provider: a path resolving outside the workspace is rejected with
   *   `SandboxError('policy')`.
   * - READS (`readFile`, `stat`, `readdir`, `exists`) are contained on
   *   `unrestricted` and `docker`, but `remote` allows reads anywhere in the
   *   VM (system binaries / stdlibs live outside the workspace, and the VM is
   *   already isolated from the host). So a read outside the workspace
   *   rejects with `policy` on unrestricted/docker but may succeed on remote.
   * - SYMLINK escapes are followed and rejected only by `unrestricted` (it
   *   shares the host FS, so realpath resolution is its sole boundary).
   *   `docker`/`remote` use a string-prefix check and rely on the
   *   container/VM root as the isolation boundary, so an in-sandbox symlink
   *   out of the workspace is not separately rejected there.
   */
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

  /**
   * Perform an HTTP request from *inside* the sandbox. The request egresses
   * through the sandbox's network and is therefore governed by the network
   * policy declared when the sandbox was created (allowlist/deny-all/etc.) —
   * it never runs in the host process. Isolated providers (docker, remote)
   * implement this by running an in-sandbox HTTP client over `exec`; the
   * host-process `unrestricted` provider, which has no isolation boundary,
   * fetches in-process. The returned `Response` is synthesized from the
   * client's output (status, content-type, body).
   */
  fetch(input: string | URL, init?: RequestInit): Promise<Response>

  /**
   * Release this lease on the sandbox. By default an *owner's* release maps to
   * a state-preserving call (pause/stop) when the sandbox is persistent, so the
   * next factory invocation can transparently reattach by `sandboxKey`; an
   * ephemeral owner, or any non-owner (attacher) lease, just detaches.
   *
   * Pass `reclaim: true` to signal the owning entity has reached a terminal
   * state (killed/stopped) so its sandbox should be WIPED now rather than
   * preserved — honoured only for an owner lease (an attacher can never reclaim
   * the owner's sandbox). Removal still waits for any concurrent leases to
   * drain. Not idempotent.
   */
  dispose(opts?: { reclaim?: boolean }): Promise<void>
}

/**
 * Factory invoked by the runtime at the start of each wake-session to
 * construct `ctx.sandbox`. Closures may hold caches as in-process
 * optimizations, but correctness must not depend on the cache
 * surviving a host cold start — provider-side identity must be
 * derivable from `sandboxKey` alone (deterministic name, label, etc.)
 * so a wake delivered to a freshly cold-started ephemeral host
 * (Cloudflare Workers, Lambda) can still reattach to the warm
 * provider-side sandbox.
 */
export interface SandboxFactoryParams {
  /**
   * Resolved identity of the sandbox to construct (or reattach to). Computed
   * upstream from the entity's sandbox config + the live wake (see
   * `resolveSandboxIdentity`): an explicit/inherited key, a per-entity key
   * (the entity URL), or a per-wake key (`entityUrl#wakeId`). Providers derive
   * provider-side identity (container name, workspace id) from this and
   * reattach to a live sandbox with the same key.
   */
  sandboxKey: string
  /**
   * Idle-teardown durability, resolved upstream. `true` ⇒ the provider
   * PRESERVES the sandbox on idle (stop / suspend) so a later wake or
   * collaborator can reattach by `sandboxKey`; `false` ⇒ it is WIPED on idle
   * (remove / kill). Orthogonal to identity — a private (per-entity/per-wake)
   * sandbox may be persistent, and an explicitly-keyed one may be ephemeral.
   */
  persistent: boolean
  /**
   * Ownership, resolved upstream. `true` ⇒ this entity OWNS the sandbox: the
   * provider creates it if absent and this entity's lifecycle governs teardown.
   * `false` ⇒ ATTACH-only: the provider reattaches to an already-live sandbox
   * with this `sandboxKey` and rejects with `SandboxError('unavailable')` if
   * none exists (it never creates a fresh, empty one), and disposing never
   * tears the owner's sandbox down.
   */
  owner: boolean
  /** The entity this wake belongs to. Useful for logs/labels, not identity. */
  entityUrl: string
  entityType: string
  args: Readonly<Record<string, unknown>>
}

export type SandboxFactory = (params: SandboxFactoryParams) => Promise<Sandbox>

/**
 * Named sandbox profile registered on a runtime. The runtime advertises
 * its profile names + labels to the agents-server; entity types reference
 * profiles by name; spawn-time picks one of the entity's allowed profiles.
 * The factory closure stays local to the runtime — only the descriptive
 * fields (`name`, `label`, `description`) cross the wire.
 */
export interface SandboxProfile {
  /** Stable wire identifier (e.g. `local`, `docker`). */
  name: string
  /** Human-readable label shown in the UI picker. */
  label: string
  /** Optional longer-form description shown as a tooltip / row subtitle. */
  description?: string
  /**
   * True when the sandbox lives off-host (a remote provider VM) and is
   * therefore reachable from any runner. The agents-server uses this to
   * relax the co-location guard: a shared remote sandbox does not require
   * its collaborators to be pinned to one runner (a shared *local* sandbox
   * does, since the container exists on a single host). Defaults to false —
   * profiles are treated as host-local unless they opt in.
   */
  remote?: boolean
  factory: SandboxFactory
}

/**
 * Egress policy for a sandbox. How strongly each mode is enforced depends on
 * the provider — read the per-mode notes before relying on one as a boundary:
 *
 * - `deny-all` — a hard boundary on the isolated providers: docker gives the
 *   container no network interface (`NetworkMode=none`); remote denies at the
 *   VM. Nothing inside (exec, fetch, or otherwise) can egress.
 * - `allow-all` — no egress restriction.
 * - `allowlist` — only a *surface* protection on docker, NOT a boundary: it is
 *   enforced host-side at the `fetch()` tool path alone (see
 *   `docker/net-policy.ts`). Code run via `exec`/bash has direct bridge egress
 *   and is NOT constrained by the allowlist, so do not treat docker+allowlist
 *   as network isolation — use `deny-all` for that. Remote enforces the
 *   allowlist at the VM boundary (provider-dependent; see the e2b adapter).
 */
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
