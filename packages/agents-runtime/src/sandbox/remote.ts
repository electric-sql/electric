import {
  SandboxError,
  type DirEntry,
  type FileStat,
  type NetworkPolicy,
  type Sandbox,
  type SandboxExecOpts,
  type SandboxExecResult,
} from './types'
import { createE2BClient } from './remote/e2b'
import { fetchInSandbox } from './exec-fetch'
import { sandboxWipesOnDispose } from './identity'
import {
  absoluteSandboxPath,
  assertAbsolutePosixWorkingDirectory,
  isPathWithinSandbox,
} from './path-containment'
import type { RemoteSandboxClient } from './remote/types'

export type RemoteProvider = `e2b`

export interface RemoteSandboxOpts {
  provider: RemoteProvider
  /** Path inside the remote workspace; default `/work`. */
  workingDirectory?: string
  /** Provider-specific API key (or read from env via the SDK). */
  apiKey?: string
  /** Provider-specific workspace template name/id. */
  template?: string
  /**
   * Stable identity used to reattach to the workspace. The adapter derives a
   * provider-side handle from this (e.g. e2b sandbox metadata) so a later wake
   * — possibly on a different host — reconnects to the same VM while it's
   * alive, regardless of `persistent`. Resolved upstream (per-entity URL,
   * per-wake `url#wakeId`, or an explicit shared key).
   */
  sandboxKey?: string
  /**
   * Idle-teardown durability. `true` ⇒ `dispose()` PRESERVES the workspace
   * (suspend) so a later wake or collaborator reconnects by `sandboxKey` with
   * state intact; `false` (default) ⇒ `dispose()` KILLS it (wiped). Orthogonal
   * to identity — a private (per-entity/per-wake) workspace may be persistent.
   */
  persistent?: boolean
  /**
   * Ownership of the keyed workspace. `true` (default) ⇒ OWNER: create the VM
   * if absent and let this lease's lifecycle govern teardown. `false` ⇒
   * ATTACHER: reconnect to an already-live VM for this `sandboxKey` and reject
   * with `SandboxError('unavailable')` if none exists (never create a fresh,
   * empty one); `dispose()` only detaches and never kills the owner's VM.
   */
  owner?: boolean
  /**
   * The provider timeout window (ms). While a wake holds the sandbox the
   * adapter heartbeats to keep it within this window; once the wake ends a
   * persistent workspace auto-suspends this long after the last heartbeat
   * (state preserved for reattach). Kept short to bound the trailing idle cost.
   * Provider default applies when omitted.
   */
  keepAliveMs?: number
  /**
   * Hostname allowlist for outbound egress from the workspace. Applied to the
   * provider VM at creation (e.g. e2b `network.allowOut`). Default: deny
   * everything.
   *
   * @deprecated prefer `initialNetworkPolicy`. When both are provided
   *   `initialNetworkPolicy` wins.
   */
  allowedHosts?: ReadonlyArray<string>
  initialNetworkPolicy?: NetworkPolicy
  /**
   * Pre-constructed client. Bypasses provider SDK loading — used by tests
   * and by customers who want to construct the provider client themselves
   * (e.g. with custom retry/observability wrappers).
   */
  client?: RemoteSandboxClient
}

/**
 * Creates a Sandbox backed by a remote workspace (microVM or container) at a
 * SaaS provider. The working directory lives inside the provider's VM; FS
 * methods round-trip to the provider over its SDK. Cost: one network RTT
 * per call. Use per-wake, not per `useAgent`.
 *
 * `sandbox.fetch()` runs *inside* the VM (via an in-sandbox HTTP client over
 * `exec`), so outbound requests egress from the workspace and are governed by
 * the network policy applied to the VM at creation — not from the host
 * process. The policy is declared up front; it cannot be changed mid-session.
 */
export async function remoteSandbox(opts: RemoteSandboxOpts): Promise<Sandbox> {
  const workingDirectory = opts.workingDirectory ?? `/work`
  // Names a location inside the provider VM, so it must be absolute POSIX —
  // a relative value would silently join against the host cwd in containment.
  assertAbsolutePosixWorkingDirectory(workingDirectory)
  const persistent = opts.persistent === true
  const owner = opts.owner !== false
  const initialPolicy: NetworkPolicy =
    opts.initialNetworkPolicy ??
    (opts.allowedHosts && opts.allowedHosts.length > 0
      ? { mode: `allowlist`, allow: [...opts.allowedHosts] }
      : { mode: `deny-all` })
  // A caller-supplied `client` (tests, custom wrappers) is responsible for its
  // own egress config; the policy is applied by the provider adapter we load.
  const client =
    opts.client ?? (await loadClient(opts, workingDirectory, initialPolicy))
  return new RemoteSandbox(
    `remote:${opts.provider}`,
    workingDirectory,
    client,
    persistent,
    owner
  )
}

async function loadClient(
  opts: RemoteSandboxOpts,
  workingDirectory: string,
  initialPolicy: NetworkPolicy
): Promise<RemoteSandboxClient> {
  switch (opts.provider) {
    case `e2b`:
      return createE2BClient({
        apiKey: opts.apiKey,
        template: opts.template,
        workingDirectory,
        persistent: opts.persistent === true,
        owner: opts.owner !== false,
        sandboxKey: opts.sandboxKey,
        // Undefined flows through to the adapter's own default.
        keepAliveMs: opts.keepAliveMs,
        initialNetworkPolicy: initialPolicy,
      })
    default:
      throw new SandboxError(
        `unavailable`,
        `remoteSandbox: unsupported provider "${String(opts.provider)}". Supported: 'e2b'.`
      )
  }
}

class RemoteSandbox implements Sandbox {
  private disposed = false

  constructor(
    readonly name: string,
    readonly workingDirectory: string,
    private readonly client: RemoteSandboxClient,
    private readonly persistent: boolean,
    private readonly owner: boolean
  ) {}

  async exec(opts: SandboxExecOpts): Promise<SandboxExecResult> {
    this.assertLive()
    const r = await this.client.exec({
      command: opts.command,
      cwd: opts.cwd ?? this.workingDirectory,
      env: opts.env,
      timeoutMs: opts.timeoutMs,
      stdin: opts.stdin,
    })
    const max = opts.maxOutputBytes ?? Number.POSITIVE_INFINITY
    const stdout = r.stdout.length > max ? r.stdout.subarray(0, max) : r.stdout
    const stderr = r.stderr.length > max ? r.stderr.subarray(0, max) : r.stderr
    const outputTruncated = r.stdout.length > max || r.stderr.length > max
    return {
      exitCode: r.exitCode,
      signal: r.signal ?? null,
      stdout,
      stderr,
      timedOut: r.timedOut ?? false,
      // Remote providers don't yet propagate caller-side aborts into the
      // VM; the field exists for interface conformance and will become
      // meaningful once the client contract supports forwarding signals.
      aborted: false,
      outputTruncated,
    }
  }

  async readFile(path: string): Promise<Buffer> {
    this.assertLive()
    this.assertReadable(path)
    return this.client.readFile(this.absolute(path))
  }

  async writeFile(path: string, content: Buffer | string): Promise<void> {
    this.assertLive()
    this.assertWritable(path)
    await this.client.writeFile(this.absolute(path), content)
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    this.assertLive()
    this.assertWritable(path)
    if (opts?.recursive) {
      await this.makeDirRecursive(this.absolute(path))
    } else {
      await this.client.mkdir(this.absolute(path))
    }
  }

  async readdir(path: string): Promise<ReadonlyArray<DirEntry>> {
    this.assertLive()
    try {
      return await this.client.readdir(this.absolute(path))
    } catch (err) {
      throw wrapFsError(err, `readdir`, path)
    }
  }

  async exists(path: string): Promise<boolean> {
    this.assertLive()
    try {
      return await this.client.exists(this.absolute(path))
    } catch (err) {
      throw wrapFsError(err, `exists`, path)
    }
  }

  async remove(path: string, opts?: { recursive?: boolean }): Promise<void> {
    this.assertLive()
    this.assertWritable(path)
    try {
      await this.client.remove(this.absolute(path), opts)
    } catch (err) {
      throw wrapFsError(err, `remove`, path)
    }
  }

  async stat(path: string): Promise<FileStat> {
    this.assertLive()
    try {
      return await this.client.stat(this.absolute(path))
    } catch (err) {
      throw wrapFsError(err, `stat`, path)
    }
  }

  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    this.assertLive()
    // Run the request inside the VM. Egress is enforced by the provider's
    // own network controls, configured from the policy at creation; a denied
    // host surfaces as a failed request from the in-sandbox client.
    return fetchInSandbox((opts) => this.exec(opts), input, init)
  }

  async dispose(opts?: { reclaim?: boolean }): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    // The VM is WIPED (kill) only when an OWNER releases it AND there's nothing
    // to preserve — i.e. its entity went terminal (`reclaim`) or it's ephemeral.
    // Otherwise we detach via suspend(): an owner of a persistent workspace
    // hands lifecycle back to the provider (heartbeat stops → auto-suspend,
    // state preserved for reattach), and a non-owner attacher merely stops its
    // own heartbeat without ever killing the owner's VM. A client without
    // suspend() falls back to kill().
    const wipe =
      this.owner &&
      sandboxWipesOnDispose(opts?.reclaim === true, this.persistent)
    if (!wipe && this.client.suspend) {
      await this.client.suspend()
    } else {
      await this.client.kill()
    }
  }

  private absolute(path: string): string {
    return absoluteSandboxPath(this.workingDirectory, path)
  }

  private assertReadable(path: string): void {
    // Reads outside the working directory are allowed (system binaries,
    // language stdlibs etc. live elsewhere in the VM). The remote workspace
    // is already isolated from the host filesystem; no extra TS gate needed.
    void path
  }

  private assertWritable(path: string): void {
    if (!isPathWithinSandbox(this.workingDirectory, path)) {
      throw new SandboxError(
        `policy`,
        `remoteSandbox: write access to "${path}" is denied (outside working directory ${this.workingDirectory})`
      )
    }
  }

  private async makeDirRecursive(path: string): Promise<void> {
    // Walk parents shallowest-first so each mkdir succeeds. The provider's
    // own mkdir typically fails on missing parents.
    const parts = path.split(`/`).filter(Boolean)
    let prefix = path.startsWith(`/`) ? `/` : ``
    for (let i = 0; i < parts.length; i++) {
      prefix = prefix + (prefix.endsWith(`/`) ? `` : `/`) + parts[i]
      try {
        await this.client.mkdir(prefix)
      } catch {
        // Path may already exist — ignore.
      }
    }
  }

  private assertLive(): void {
    if (this.disposed) {
      throw new SandboxError(
        `runtime`,
        `remoteSandbox: operation called after dispose()`
      )
    }
  }
}

function wrapFsError(err: unknown, op: string, path: string): Error {
  if (err instanceof SandboxError) return err
  const e = err as NodeJS.ErrnoException
  return new SandboxError(
    `runtime`,
    `remoteSandbox.${op}("${path}") failed: ${e.code ?? ``} ${e.message ?? String(err)}`.trim()
  )
}
