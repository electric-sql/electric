import { createHash } from 'node:crypto'
import { SandboxError } from '../types'
import type { FileStat, NetworkPolicy } from '../types'
import type { RemoteSandboxClient } from './types'

interface E2BCommandsRun {
  stdout: string
  stderr: string
  exitCode: number | null
}

interface E2BFileEntry {
  name: string
  type?: `file` | `dir`
  path?: string
}

interface E2BFileInfo {
  name?: string
  type?: `file` | `dir`
  size?: number
  modifiedTime?: string | Date
}

interface E2BSandboxInstance {
  /** Provider-assigned id; the handle used to reconnect from another host. */
  sandboxId: string
  commands: {
    run(
      cmd: string,
      opts?: { cwd?: string; envs?: Record<string, string>; timeoutMs?: number }
    ): Promise<E2BCommandsRun>
  }
  files: {
    read(
      path: string,
      opts?: { format?: `bytes` | `text` }
    ): Promise<Uint8Array | string>
    write(path: string, content: string | Uint8Array): Promise<unknown>
    makeDir(path: string): Promise<unknown>
    list?(path: string): Promise<ReadonlyArray<E2BFileEntry>>
    exists?(path: string): Promise<boolean>
    remove?(path: string): Promise<unknown>
    getInfo?(path: string): Promise<E2BFileInfo>
  }
  /**
   * Reset the (absolute) keep-alive countdown to `timeoutMs` from now. e2b's
   * timeout is not idle-based and is not refreshed by activity, so a heartbeat
   * calls this to keep the VM alive while a wake holds it.
   */
  setTimeout(timeoutMs: number): Promise<void>
  kill(): Promise<unknown>
}

/** Lifecycle policy for a created sandbox (e2b SandboxOpts.lifecycle). */
interface E2BLifecycle {
  onTimeout: `pause` | `kill`
  autoResume?: boolean
}

interface E2BCreateOpts {
  apiKey?: string
  metadata?: Record<string, string>
  timeoutMs?: number
  lifecycle?: E2BLifecycle
  /**
   * Egress: `false` blocks all outbound traffic (≡ `network.denyOut` of
   * `0.0.0.0/0`). Maps from our deny-all policy.
   */
  allowInternetAccess?: boolean
  /**
   * Outbound allow/deny lists (hostnames, IPs, CIDRs). When `allowOut` is set,
   * only those destinations are reachable. Maps from our allowlist policy.
   */
  network?: { allowOut?: Array<string>; denyOut?: Array<string> }
}

/** The subset of e2b create opts that encode an egress policy. */
type E2BNetworkCreateOpts = Pick<
  E2BCreateOpts,
  `allowInternetAccess` | `network`
>

/**
 * Translate our provider-neutral {@link NetworkPolicy} into e2b's create-time
 * egress options. e2b enforces these at the VM boundary, so a policy declared
 * here governs the workspace's *own* outbound traffic (including
 * `sandbox.fetch()`, which runs inside the VM). `allow-all` leaves the e2b
 * default (internet enabled); `deny-all` disables internet; `allowlist` pins
 * `network.allowOut` (e2b additionally auto-allows DNS, and filters by Host
 * header on :80 / SNI on :443).
 */
export function e2bNetworkCreateOpts(
  policy: NetworkPolicy
): E2BNetworkCreateOpts {
  switch (policy.mode) {
    case `allow-all`:
      return { allowInternetAccess: true }
    case `deny-all`:
      return { allowInternetAccess: false }
    case `allowlist`:
      return { network: { allowOut: [...policy.allow] } }
  }
}

/** Subset of e2b `SandboxInfo` we consult when reattaching by key. */
interface E2BSandboxInfo {
  sandboxId: string
  metadata?: Record<string, string>
  state?: string
  startedAt?: Date
}

/** Subset of the e2b `Sandbox` class statics we depend on. */
export interface E2BSandboxClass {
  create(opts?: E2BCreateOpts): Promise<E2BSandboxInstance>
  create(template: string, opts?: E2BCreateOpts): Promise<E2BSandboxInstance>
  connect(
    sandboxId: string,
    opts?: { apiKey?: string; timeoutMs?: number }
  ): Promise<E2BSandboxInstance>
  list(opts?: {
    query?: { metadata?: Record<string, string>; state?: Array<string> }
  }): { nextItems(): Promise<ReadonlyArray<E2BSandboxInfo>> }
}

/** Metadata key that tags a sandbox with its reuse identity. */
const SANDBOX_KEY_METADATA = `electric.sandbox.key`
/**
 * The e2b timeout window. Kept short: a heartbeat refreshes it while a wake is
 * active, and once the wake ends the platform reaps the VM this long after the
 * last refresh — pausing a persistent VM (onTimeout:'pause', state preserved
 * for reattach) or killing an ephemeral one (onTimeout:'kill'). A short window
 * means a small trailing idle-compute tail.
 */
const DEFAULT_KEEP_ALIVE_MS = 2 * 60 * 1000
/** Refresh well inside the window so an event-loop hiccup can't lapse it. */
function heartbeatIntervalFor(keepAliveMs: number): number {
  return Math.max(15_000, Math.floor(keepAliveMs / 2))
}

/**
 * True iff the optional `e2b` peer dependency is installed. Mirrors
 * `isDockerAvailable()` so a runtime never advertises an e2b profile whose
 * factory would throw at wake. (Resolved in this package's context, where the
 * peer dep lives, rather than the embedder's.)
 */
export async function isE2BAvailable(): Promise<boolean> {
  try {
    await import(`e2b`)
    return true
  } catch {
    return false
  }
}

/**
 * Wraps an e2b Sandbox instance behind the provider-neutral
 * RemoteSandboxClient interface. The e2b SDK is loaded dynamically so it
 * remains an optional peer dependency — installing agents-runtime does not
 * pull in e2b unless the customer wants the remote provider.
 *
 * The workspace is always tagged with `sandboxKey` and reattachable: a later
 * wake (possibly on a different host) reconnects to the same VM while it's
 * alive. `persistent` only changes idle reaping — the VM auto-pauses
 * (onTimeout:'pause', state preserved for reattach) when persistent, else it's
 * killed (onTimeout:'kill'). The adapter heartbeats `setTimeout` while the wake
 * is active (keeping the VM alive regardless of durability) and stops on
 * dispose; `RemoteSandbox.dispose` then suspends (persistent) or kills.
 */
export async function createE2BClient(opts: {
  apiKey?: string
  template?: string
  workingDirectory: string
  persistent?: boolean
  owner?: boolean
  sandboxKey?: string
  keepAliveMs?: number
  /** Egress policy applied to the VM at creation. Default: deny everything. */
  initialNetworkPolicy?: NetworkPolicy
  /** Optional sink for diagnostics (e.g. swallowed keep-alive failures). */
  log?: (message: string) => void
}): Promise<RemoteSandboxClient> {
  let mod: { Sandbox: E2BSandboxClass }
  try {
    // e2b is an optional peer dependency — resolved at runtime when the
    // customer opts into the remote provider.
    mod = (await import(`e2b`)) as unknown as typeof mod
  } catch {
    throw new Error(
      `remoteSandbox({provider:'e2b'}) requires the "e2b" package. Install it: pnpm add e2b`
    )
  }
  const persistent = opts.persistent === true
  const keepAliveMs = opts.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS
  const network = e2bNetworkCreateOpts(
    opts.initialNetworkPolicy ?? { mode: `deny-all` }
  )
  const sbx = await connectOrCreateE2BSandbox(mod.Sandbox, {
    apiKey: opts.apiKey,
    template: opts.template,
    persistent,
    owner: opts.owner !== false,
    sandboxKey: opts.sandboxKey,
    keepAliveMs,
    network,
  })
  // Ensure the working directory exists in the VM.
  await sbx.files.makeDir(opts.workingDirectory).catch(() => {
    /* ignore — may already exist */
  })
  return adaptE2B(sbx, opts.workingDirectory, { keepAliveMs, log: opts.log })
}

/**
 * Resolve the e2b sandbox to operate on. Reattach by key regardless of
 * durability: we look up a running/paused sandbox tagged with the key and
 * `connect()` (which auto-resumes a paused one). An OWNER that finds none
 * creates one tagged with the key; an ATTACHER (`owner: false`) that finds none
 * rejects with `SandboxError('unavailable')` rather than conjuring a fresh,
 * empty VM under the shared key. `persistent` only sets the idle reaping —
 * pause (state preserved, reattachable) vs kill (wiped). A keyless one-off is
 * always an owner-style create. Exported (with the SDK class injected) so the
 * reattach decision is unit-testable without a live e2b account.
 */
export async function connectOrCreateE2BSandbox(
  Sandbox: E2BSandboxClass,
  opts: {
    apiKey?: string
    template?: string
    persistent: boolean
    owner?: boolean
    sandboxKey?: string
    keepAliveMs: number
    /** Egress policy create-opts; applied to every freshly created VM. */
    network?: E2BNetworkCreateOpts
  }
): Promise<E2BSandboxInstance> {
  const network = opts.network ?? {}
  const owner = opts.owner !== false
  // Idle reaping: a persistent VM pauses (preserves state for reattach), an
  // ephemeral one is killed (wiped). Both stay reattachable while alive.
  const lifecycle: E2BLifecycle = opts.persistent
    ? { onTimeout: `pause`, autoResume: true }
    : { onTimeout: `kill` }

  if (!opts.sandboxKey) {
    const createOpts: E2BCreateOpts = {
      apiKey: opts.apiKey,
      timeoutMs: opts.keepAliveMs,
      lifecycle,
      ...network,
    }
    return opts.template
      ? Sandbox.create(opts.template, createOpts)
      : Sandbox.create(createOpts)
  }

  const keyTag = sandboxKeyTag(opts.sandboxKey)

  const existing = await firstSandboxForKey(Sandbox, keyTag)
  if (existing) {
    // Reachable from any host: a wake delivered to a freshly cold-started
    // host reconnects here. connect() auto-resumes a paused sandbox. Egress
    // policy is fixed at creation, so a reattached VM keeps whatever policy
    // its creator declared — we don't (and can't) re-apply it here.
    return Sandbox.connect(existing.sandboxId, {
      apiKey: opts.apiKey,
      timeoutMs: opts.keepAliveMs,
    })
  }

  if (!owner) {
    throw new SandboxError(
      `unavailable`,
      `remoteSandbox: cannot attach — no owner workspace is live for this key. The owning entity must create it first.`
    )
  }

  const createOpts: E2BCreateOpts = {
    apiKey: opts.apiKey,
    metadata: { [SANDBOX_KEY_METADATA]: keyTag },
    timeoutMs: opts.keepAliveMs,
    lifecycle,
    ...network,
  }
  return opts.template
    ? Sandbox.create(opts.template, createOpts)
    : Sandbox.create(createOpts)
}

function sandboxKeyTag(sandboxKey: string): string {
  return createHash(`sha256`).update(sandboxKey).digest(`hex`).slice(0, 32)
}

async function firstSandboxForKey(
  Sandbox: E2BSandboxClass,
  keyTag: string
): Promise<E2BSandboxInfo | undefined> {
  const page = await Sandbox.list({
    query: {
      metadata: { [SANDBOX_KEY_METADATA]: keyTag },
      state: [`running`, `paused`],
    },
  }).nextItems()
  // If a cross-host create race produced duplicates, every host determinist-
  // ically converges on the oldest; the stragglers idle out on their own.
  return [...page].sort(compareBySandboxAge)[0]
}

function compareBySandboxAge(a: E2BSandboxInfo, b: E2BSandboxInfo): number {
  const at = a.startedAt ? a.startedAt.getTime() : 0
  const bt = b.startedAt ? b.startedAt.getTime() : 0
  if (at !== bt) return at - bt
  return a.sandboxId < b.sandboxId ? -1 : a.sandboxId > b.sandboxId ? 1 : 0
}

export function adaptE2B(
  sbx: E2BSandboxInstance,
  defaultCwd: string,
  opts?: {
    keepAliveMs?: number
    heartbeatIntervalMs?: number
    log?: (message: string) => void
  }
): RemoteSandboxClient {
  // Refresh the absolute timeout while this wake holds the VM so a long-running
  // wake isn't reaped out from under us — regardless of durability, since e2b's
  // timeout is not idle-based. We deliberately never pause() or shorten the
  // timeout here: a collaborator still heartbeating (possibly on another host)
  // keeps the VM alive, and only once every holder stops does the platform reap
  // it per its lifecycle (pause when persistent, kill when ephemeral). That
  // makes the lifecycle refcount-free without any cross-host coordination.
  const keepAliveMs = opts?.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS
  const interval =
    opts?.heartbeatIntervalMs ?? heartbeatIntervalFor(keepAliveMs)
  let heartbeat: ReturnType<typeof setInterval> | undefined = setInterval(
    () => {
      void sbx.setTimeout(keepAliveMs).catch((err: unknown) => {
        // Usually benign: the VM was killed/paused elsewhere, so there's
        // nothing to keep alive. But this also swallows SDK/network/auth
        // failures, so leave a debug trail for an operator chasing a stuck
        // reattach. Intentionally non-fatal — a failed keep-alive only means
        // the VM may reap sooner, which the lifecycle already tolerates.
        opts?.log?.(
          `e2b keep-alive refresh failed: ${err instanceof Error ? err.message : String(err)}`
        )
      })
    },
    interval
  )
  // Don't let the keep-alive timer hold the process open.
  heartbeat.unref?.()
  const stopHeartbeat = (): void => {
    if (heartbeat) {
      clearInterval(heartbeat)
      heartbeat = undefined
    }
  }
  return {
    async exec(opts) {
      const r = await sbx.commands.run(opts.command, {
        cwd: opts.cwd ?? defaultCwd,
        envs: opts.env,
        timeoutMs: opts.timeoutMs,
      })
      return {
        stdout: Buffer.from(r.stdout ?? ``),
        stderr: Buffer.from(r.stderr ?? ``),
        exitCode: r.exitCode,
      }
    },
    async readFile(path) {
      const out = await sbx.files.read(path, { format: `bytes` })
      return Buffer.isBuffer(out) ? out : Buffer.from(out as Uint8Array)
    },
    async writeFile(path, content) {
      await sbx.files.write(path, content)
    },
    async mkdir(path) {
      await sbx.files.makeDir(path)
    },
    async readdir(path) {
      if (sbx.files.list) {
        const entries = await sbx.files.list(path)
        return entries.map((e) => ({
          name: e.name,
          type: e.type === `dir` ? (`directory` as const) : (`file` as const),
        }))
      }
      // Fallback via `find -print0` (NUL-delimited, newline-safe). The
      // `%y` printf code reports d/f/l so we can populate `type` correctly
      // including symlinks. BusyBox `find` lacks `-printf`; in that case we
      // re-run with a plainer command and lose symlink fidelity.
      const r = await sbx.commands.run(
        `find ${shellQuote(path)} -mindepth 1 -maxdepth 1 -printf '%y\\t%f\\0' 2>/dev/null || find ${shellQuote(path)} -mindepth 1 -maxdepth 1 -printf '%f\\0'`
      )
      if (r.exitCode !== 0) {
        throwShellError(r.stderr, `readdir`, path)
      }
      const records = r.stdout.split(`\0`).filter((s) => s.length > 0)
      return records.map((rec) => {
        const tab = rec.indexOf(`\t`)
        if (tab === -1) {
          return { name: rec, type: `other` as const }
        }
        const kind = rec.slice(0, tab)
        const name = rec.slice(tab + 1)
        const type: `file` | `directory` | `symlink` | `other` =
          kind === `d`
            ? `directory`
            : kind === `f`
              ? `file`
              : kind === `l`
                ? `symlink`
                : `other`
        return { name, type }
      })
    },
    async exists(path) {
      if (sbx.files.exists) return sbx.files.exists(path)
      const r = await sbx.commands.run(`test -e ${shellQuote(path)}`)
      return r.exitCode === 0
    },
    async remove(path, opts) {
      if (sbx.files.remove && !opts?.recursive) {
        await sbx.files.remove(path)
        return
      }
      // `-f` would swallow missing-path errors; we want the conformance
      // contract of "remove of nonexistent throws". Use plain `rm` (or
      // `rm -r` for recursive) and lift exit codes into typed errors.
      const flag = opts?.recursive ? `-r` : ``
      const r = await sbx.commands.run(`rm ${flag} ${shellQuote(path)}`.trim())
      if (r.exitCode !== 0) {
        throwShellError(r.stderr, `remove`, path)
      }
    },
    async stat(path): Promise<FileStat> {
      if (sbx.files.getInfo) {
        const info = await sbx.files.getInfo(path)
        return {
          type:
            info.type === `dir`
              ? `directory`
              : info.type === `file`
                ? `file`
                : `other`,
          size: info.size ?? 0,
          mtimeMs: info.modifiedTime
            ? new Date(info.modifiedTime).getTime()
            : 0,
        }
      }
      // Fallback: run `stat` once and validate the output shape. GNU/BSD
      // formats both produce three pipe-separated fields; we use `||` to
      // try GNU first then BSD, with stderr suppression so the two attempts
      // don't corrupt each other's output.
      const r = await sbx.commands.run(
        `(stat -c '%F|%s|%Y' ${shellQuote(path)} 2>/dev/null || stat -f '%HT|%z|%m' ${shellQuote(path)} 2>/dev/null)`
      )
      const fields = r.stdout.trim().split(`|`)
      if (r.exitCode !== 0 || fields.length !== 3) {
        const err = new Error(
          r.stderr || `stat: no such file or directory: ${path}`
        ) as NodeJS.ErrnoException
        err.code = `ENOENT`
        throw err
      }
      const [kind, size, mtime] = fields
      const lowerKind = (kind ?? ``).toLowerCase()
      const type: FileStat[`type`] = lowerKind.includes(`directory`)
        ? `directory`
        : lowerKind.includes(`symbolic`)
          ? `symlink`
          : lowerKind.includes(`regular`) || lowerKind === `file`
            ? `file`
            : `other`
      const mtimeNum = Number(mtime)
      return {
        type,
        size: Number(size) || 0,
        mtimeMs: Number.isFinite(mtimeNum) ? mtimeNum * 1000 : 0,
      }
    },
    async kill() {
      stopHeartbeat()
      await sbx.kill()
    },
    async suspend() {
      // Persistent workspace teardown: stop refreshing the keep-alive and let
      // the platform take over. The VM auto-pauses ~keepAliveMs after our last
      // heartbeat (onTimeout:'pause'), preserving filesystem + memory state
      // for reattach, and is reaped after e2b's paused-retention window. We
      // don't pause() or shorten the timeout here, so a collaborator still
      // heartbeating elsewhere is never disrupted.
      stopHeartbeat()
    },
  }
}

function shellQuote(arg: string): string {
  return `'` + arg.replace(/'/g, `'\\''`) + `'`
}

function throwShellError(stderr: string, op: string, path: string): never {
  const err = new Error(
    stderr || `${op}: failed for ${path}`
  ) as NodeJS.ErrnoException
  // Best-effort code classification from common stderr substrings; falls
  // back to EIO so consumers don't see an undefined `code` field.
  if (/No such file|cannot stat|cannot access/i.test(stderr))
    err.code = `ENOENT`
  else if (/Permission denied/i.test(stderr)) err.code = `EACCES`
  else err.code = `EIO`
  throw err
}
