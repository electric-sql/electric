import { relative, resolve } from 'node:path'
import {
  SandboxError,
  type DirEntry,
  type FileStat,
  type Sandbox,
  type SandboxExecOpts,
  type SandboxExecResult,
} from './types'
import { createE2BClient } from './remote/e2b'
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
  /** Hostname allowlist for outbound `sandbox.fetch()`. Default: deny everything. */
  allowedHosts?: ReadonlyArray<string>
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
 * per call. Use per-wake, not per `useAgent` (see plans/sandbox-design.md
 * §4).
 *
 * `sandbox.fetch()` runs in the host Node process, *not* inside the VM,
 * with a TS-level hostname allowlist. To route outbound network through
 * the VM, use `sandbox.exec('curl ...')` instead.
 */
export async function remoteSandbox(opts: RemoteSandboxOpts): Promise<Sandbox> {
  const workingDirectory = opts.workingDirectory ?? `/work`
  const client = opts.client ?? (await loadClient(opts, workingDirectory))
  return new RemoteSandbox(
    `remote:${opts.provider}`,
    workingDirectory,
    client,
    new Set(opts.allowedHosts ?? [])
  )
}

async function loadClient(
  opts: RemoteSandboxOpts,
  workingDirectory: string
): Promise<RemoteSandboxClient> {
  switch (opts.provider) {
    case `e2b`:
      return createE2BClient({
        apiKey: opts.apiKey,
        template: opts.template,
        workingDirectory,
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
    private readonly allowedHosts: ReadonlySet<string>
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
    const url = typeof input === `string` ? new URL(input) : input
    if (!this.allowedHosts.has(url.hostname)) {
      throw new SandboxError(
        `policy`,
        `remoteSandbox: host "${url.hostname}" is not in allowedHosts`
      )
    }
    return globalThis.fetch(input as RequestInfo, init)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.client.kill()
  }

  private absolute(path: string): string {
    return path.startsWith(`/`) ? path : resolve(this.workingDirectory, path)
  }

  private assertReadable(path: string): void {
    // Reads outside the working directory are allowed (system binaries,
    // language stdlibs etc. live elsewhere in the VM). The remote workspace
    // is already isolated from the host filesystem; no extra TS gate needed.
    void path
  }

  private assertWritable(path: string): void {
    const absolute = this.absolute(path)
    const rel = relative(this.workingDirectory, absolute)
    if (rel.startsWith(`..`) || rel === `..`) {
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
