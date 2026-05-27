import { PassThrough } from 'node:stream'
import { realpathSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { fetchInSandbox } from './exec-fetch'
import {
  SandboxError,
  type DirEntry,
  type FileStat,
  type NetworkPolicy,
  type Sandbox,
  type SandboxExecOpts,
  type SandboxExecResult,
} from './types'
import {
  loadDockerode,
  type Dockerode,
  type DockerodeContainer,
} from './docker/loader'
import {
  getFile,
  makeDir,
  pathExists,
  putFile,
  readDir,
  removePath,
  statPath,
} from './docker/fs'
import { hostAllowedByPolicy, isPrivateOrLinkLocal } from './docker/net-policy'
import { sandboxWipesOnDispose } from './identity'
import { absoluteSandboxPath, isPathWithinSandbox } from './path-containment'

export interface DockerSandboxOpts {
  /** Absolute path inside the container (NOT a host path). Default `/work`. */
  readonly workingDirectory?: string
  /**
   * Docker image. By default we pin a known small image; callers can override
   * to bake in tooling but must supply a digest pin unless `allowFloatingTag`
   * is set, to keep images reproducible across machines.
   */
  readonly image?: string
  readonly allowFloatingTag?: boolean
  readonly env?: Readonly<Record<string, string>>
  readonly initialNetworkPolicy?: NetworkPolicy
  readonly resources?: {
    readonly memoryBytes?: number
    readonly cpus?: number
    readonly pidsLimit?: number
  }
  /** `'runc'` (default, broad compat) or `'runsc'` (gVisor, hardened). */
  readonly runtime?: `runc` | `runsc`
  /**
   * Container ports to publish to the host (bound to loopback). The host port
   * mapping can be read back via `docker inspect`; the sandbox does not expose
   * a URL-lookup primitive. Requires a network policy that grants egress
   * (deny-all gives the container no interface to bind).
   */
  readonly exposedPorts?: ReadonlyArray<number>
  readonly extraMounts?: ReadonlyArray<{
    readonly hostPath: string
    readonly containerPath: string
    /**
     * Defaults to `true`. Set `false` to bind read-write (e.g. when the
     * caller wants the entity to write to the host's working directory).
     * The docker-socket safety check still applies regardless.
     */
    readonly readOnly?: boolean
  }>
  readonly dockerSocket?: string
  readonly labels?: Readonly<Record<string, string>>
  /**
   * Stable identity for the container. The container is named deterministically
   * from this key and reattached to (rather than recreated) while it's alive,
   * so callers — sibling wakes, collaborators, an inheriting subagent — that
   * resolve to the same key converge on one container and filesystem. Resolved
   * upstream (per-entity URL, per-wake `url#wakeId`, or an explicit shared key).
   * When omitted (direct/test callers) a random key is synthesized so a
   * one-off still flows through the single registry path.
   */
  readonly sandboxKey?: string
  /**
   * Idle-teardown durability. `true` ⇒ STOP the container when idle (its
   * writable layer survives, so a later acquire restarts it with the
   * filesystem intact); `false` (default) ⇒ REMOVE it when idle (wiped). Either
   * way the container is named-by-key and reattachable while alive — this flag
   * only selects what the debounced idle teardown does.
   */
  readonly persistent?: boolean
  /**
   * Ownership of the keyed container. `true` (default) ⇒ OWNER: create the
   * container if it's absent, and this lease's teardown governs the container's
   * lifecycle (idle ⇒ stop/remove per `persistent`; `dispose({reclaim})` ⇒
   * wipe). `false` ⇒ ATTACHER: reattach to an already-live container with this
   * `sandboxKey` and reject with `SandboxError('unavailable')` if none exists (it
   * never creates a fresh, empty one); disposing only releases the lease and
   * never tears the owner's container down.
   */
  readonly owner?: boolean
  /**
   * How long the container is kept alive after its last lease disposes before
   * the idle teardown (stop or remove) runs. A re-acquire within this window (a
   * sibling wake, an inheriting subagent, ongoing collaboration) cancels the
   * teardown, so the container — and any dev server running in it — survives
   * active use; for an ephemeral container it's the window in which in-flight
   * collaborators can still reattach before it's wiped.
   * Defaults to {@link DEFAULT_IDLE_GRACE_MS}.
   */
  readonly sharedIdleGraceMs?: number
  /**
   * Observability only — never affects identity or reattach. The entity type
   * that spawned this sandbox (e.g. `horton`); recorded as a label.
   */
  readonly entityType?: string
  /**
   * Observability only. The entity URL this wake belongs to; recorded as a
   * label so `docker ps` shows what it belongs to. The container *name* is
   * always derived from `sandboxKey` (so callers that resolve to the same key
   * converge on one container), not from this — collaborators may differ.
   */
  readonly entityUrl?: string
  /**
   * If true (default), pulls the image when it's not present locally. Set
   * to false in CI where you'd rather fail fast and pre-pull.
   */
  readonly pullIfMissing?: boolean
  /** Optional progress callback during image pull. */
  readonly onPullProgress?: (event: unknown) => void
}

/**
 * Default image: small Node-capable alpine variant pinned by digest. We
 * deliberately don't ship a custom image — operators can override.
 *
 * Update procedure: pull the latest node:20-alpine, run `docker inspect
 * --format='{{index .RepoDigests 0}}' node:20-alpine`, paste here.
 */
const DEFAULT_IMAGE = `node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293`
// The digest above tracks node:20-alpine at branch-build time and works
// across linux/amd64 and linux/arm64 (it's the manifest list digest).
// Override via DockerSandboxOpts.image to pin to a different version /
// pre-provisioned image.

/** Marks every container this module creates. */
const SANDBOX_LABEL = `com.electric.sandbox`
/** The container's resolved identity key (always set; see `sandboxKey`). */
const SANDBOX_KEY_LABEL = `com.electric.sandbox.key`
/** Entity type that spawned the sandbox (observability). */
const SANDBOX_ENTITY_TYPE_LABEL = `com.electric.sandbox.entity-type`
/** Entity URL the spawning wake belonged to (observability). */
const SANDBOX_ENTITY_LABEL = `com.electric.sandbox.entity`
/**
 * `'true'` when the OWNER created the container as persistent. Read by the boot
 * sweep so a restarted process preserves persistent workspaces (to reattach by
 * key) and only reclaims ephemeral leftovers.
 */
const SANDBOX_PERSISTENT_LABEL = `com.electric.sandbox.persistent`

/** Common prefix for every container name this module assigns. */
const NAME_PREFIX = `electric-sbx`

/** Default warm window before an idle container is torn down (stop/remove). */
const DEFAULT_IDLE_GRACE_MS = 2 * 60 * 1000

/**
 * Process-local registry of live sandbox containers, keyed by container name.
 * One entry per container; every lease (owner or attacher) gets its own
 * `DockerSandbox` wrapper but they all share this entry. `refs` counts the live
 * leases so the container isn't torn down while a sibling lease still uses it.
 * When the last lease disposes, `idleTimer` schedules a debounced teardown that
 * a re-acquire within the grace cancels (see {@link scheduleIdleTeardown}).
 *
 * `persistent` (set by the OWNER at creation) records the idle action — STOP
 * (preserve) vs REMOVE (wipe). `reclaim` is set when an OWNER lease disposes
 * with `{reclaim:true}` (its entity went terminal): the container is then wiped
 * once the last lease drains, regardless of `persistent`. `container` is
 * retained so the timer can act after all wrappers are gone.
 */
interface ContainerEntry {
  refs: number
  container: DockerodeContainer
  persistent: boolean
  idleGraceMs: number
  reclaim?: boolean
  idleTimer?: ReturnType<typeof setTimeout>
}
const sandboxContainers = new Map<string, ContainerEntry>()

/**
 * Per-key serialization. Acquire (reattach + register) and the debounced idle
 * teardown run under this lock so a re-acquire can never interleave with a
 * teardown that's already in flight — the single synchronization point that
 * keeps the lifecycle race-free without any background sweeper.
 */
const keyLocks = new Map<string, Promise<unknown>>()
function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = keyLocks.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  // Swallow errors on the stored tail so one failure doesn't poison the lock
  // for later callers; `run` itself still rejects to the current caller.
  keyLocks.set(
    key,
    run.then(
      () => undefined,
      () => undefined
    )
  )
  return run
}

/** Lowercase, DNS-safe slug from an arbitrary identity string (≤24 chars). */
function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, `-`)
    .replace(/^-+/, ``)
    .slice(0, 24)
    .replace(/-+$/, ``)
  return slug || `sbx`
}

/**
 * Deterministic, DNS-safe name for a container. Derived *only* from the
 * resolved key so every caller that resolves to the same key — whatever its
 * entity type — computes the same string and converges on one container (the
 * create-race dedupes on the name). A readable slug of the key is prefixed for
 * `docker ps` legibility; the trailing hash guarantees uniqueness when two keys
 * slugify alike.
 */
function containerNameForKey(sandboxKey: string): string {
  const hash = createHash(`sha256`)
    .update(sandboxKey)
    .digest(`hex`)
    .slice(0, 12)
  return `${NAME_PREFIX}-${slugify(sandboxKey)}-${hash}`
}

/**
 * Schedule a debounced teardown of a now-idle container. Runs under the per-key
 * lock so it can't race a concurrent re-acquire; re-checks `refs` (a lease that
 * returned during the grace bumps it back above zero) before acting. A `'stop'`
 * is non-destructive — the writable layer survives and the next acquire
 * restarts it via `reattachOrCreate`; a `'remove'` wipes it. Either way the
 * registry entry is dropped afterwards so a later acquire rebuilds it. A
 * `graceMs` of 0 makes this an immediate (but still lock-serialized) teardown,
 * used for owner reclaim.
 */
function scheduleIdleTeardown(
  name: string,
  graceMs: number,
  action: `stop` | `remove`
): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    void withKeyLock(name, async () => {
      const entry = sandboxContainers.get(name)
      if (!entry || entry.refs > 0) return // re-acquired during the grace
      try {
        if (action === `stop`) {
          // `t: 0` → straight to SIGKILL. PID 1 (`sh`) ignores SIGTERM, so a
          // graceful stop would just wait the full timeout, and the container
          // holds no state outside its (preserved) filesystem.
          await entry.container.stop({ t: 0 })
        } else {
          await entry.container.remove({ force: true, v: true })
        }
      } catch {
        /* already stopped / removed / gone */
      }
      sandboxContainers.delete(name)
    })
  }, graceMs)
  timer.unref?.()
  return timer
}

export async function dockerSandbox(
  opts: DockerSandboxOpts = {}
): Promise<Sandbox> {
  const Docker = await loadDockerode()
  const docker: Dockerode = opts.dockerSocket
    ? new Docker({ socketPath: opts.dockerSocket })
    : new Docker()

  // Probe the daemon so we surface "unavailable" cleanly instead of a
  // dockerode error deep in createContainer.
  try {
    await Promise.race([
      docker.ping(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`docker ping timeout`)), 2000)
      ),
    ])
  } catch (err) {
    throw new SandboxError(
      `unavailable`,
      `dockerSandbox: cannot reach the Docker daemon (${
        err instanceof Error ? err.message : String(err)
      }). Is Docker Desktop / OrbStack running?`
    )
  }

  // Single lifecycle path: every container is named-by-key, registered, and
  // refcount + debounce managed. `persistent` only selects the idle-teardown
  // action (stop vs remove); `owner` gates creation. A direct caller that omits
  // `sandboxKey` gets a synthesized one so a one-off still flows through the path.
  const sandboxKey = opts.sandboxKey ?? randomUUID()
  const persistent = opts.persistent === true
  const owner = opts.owner !== false
  // Named deterministically from the resolved key so callers that resolve to
  // the same key converge on one container; the entity is recorded in labels.
  const containerName = containerNameForKey(sandboxKey)
  const idleGraceMs = opts.sharedIdleGraceMs ?? DEFAULT_IDLE_GRACE_MS

  const containerCwd = opts.workingDirectory ?? `/work`
  if (!containerCwd.startsWith(`/`)) {
    throw new SandboxError(
      `runtime`,
      `dockerSandbox.workingDirectory must be an absolute container path, got "${containerCwd}"`
    )
  }

  const initialPolicy: NetworkPolicy = opts.initialNetworkPolicy ?? {
    mode: `deny-all`,
  }

  // Per-lease wrapper over the shared registry entry. Each acquire (owner or
  // attacher) gets its own wrapper carrying its own `owner` flag, so an attacher
  // disposing can never reclaim the owner's container.
  const buildWrapper = (container: DockerodeContainer): DockerSandbox =>
    new DockerSandbox({
      container,
      containerCwd,
      policy: initialPolicy,
      runtime: opts.runtime ?? `runc`,
      containerName,
      owner,
    })

  // Fast path: a concurrent sibling lease in this process already holds the
  // container live (refs > 0 ⇒ running, no pending idle teardown). Bump the
  // refcount and hand back a fresh wrapper over the shared container.
  {
    const entry = sandboxContainers.get(containerName)
    if (entry && entry.refs > 0) {
      entry.refs += 1
      return buildWrapper(entry.container)
    }
  }

  // Network is granted purely by the egress policy. deny-all → no interface
  // at all (NetworkMode=none), which is the hard isolation guarantee. Any
  // other policy → bridge: the container issues requests directly, and the
  // allowlist is enforced host-side in `fetch()` rather than via an
  // in-container proxy.
  const networkMode =
    initialPolicy.mode === `deny-all` ? (`none` as const) : (`bridge` as const)

  // Publishing a port requires a network interface, which deny-all
  // (NetworkMode=none) doesn't have — surface the contradiction up front
  // rather than failing later when the binding turns out to be absent.
  if (networkMode === `none` && (opts.exposedPorts?.length ?? 0) > 0) {
    throw new SandboxError(
      `runtime`,
      `dockerSandbox: exposedPorts requires a network policy that grants egress; deny-all gives the container no network interface.`
    )
  }

  const baseEnv: Record<string, string> = {
    HOME: `/work`,
    ...opts.env,
  }

  const portBindings = makePortBindings(opts.exposedPorts ?? [])
  const exposedPorts = makeExposedPortsObject(opts.exposedPorts ?? [])

  const memoryBytes = opts.resources?.memoryBytes ?? 2 * 1024 * 1024 * 1024
  const nanoCpus = Math.floor((opts.resources?.cpus ?? 2) * 1_000_000_000)
  const pidsLimit = opts.resources?.pidsLimit ?? 1024

  // Hardened HostConfig — caller cannot override (no surface area).
  // NB: ReadonlyRootfs is *not* enabled by default because dockerode's
  // putArchive (the primitive backing writeFile / mkdir / readFile)
  // operates at the storage-driver layer, which Docker treats as a rootfs
  // write and rejects when the rootfs is RO — even when the target path
  // is a tmpfs / volume mount. The remaining flags below are the load-
  // bearing hardening: drop all caps, no new privileges, no docker socket,
  // strict ulimits, resource caps. Operators who want RO rootfs should also
  // stop using sandbox.writeFile / mkdir and do all writes via sandbox.exec
  // (echo > /work/...) which goes through the container's own mount namespace
  // and respects the tmpfs.
  //
  // No AutoRemove: every container lingers for the idle grace after its last
  // lease (so an in-window collaborator can reattach) and is then torn down by
  // the debounced teardown — STOP if persistent, REMOVE if ephemeral. Crash
  // leftovers are reclaimed by the boot sweep, not AutoRemove.
  const HostConfig = {
    Tmpfs: {
      '/tmp': `rw,size=64m,mode=1777`,
    },
    CapDrop: [`ALL`],
    CapAdd: [],
    SecurityOpt: [`no-new-privileges:true`],
    Privileged: false,
    PidsLimit: pidsLimit,
    Memory: memoryBytes,
    MemorySwap: memoryBytes, // disables swap
    NanoCpus: nanoCpus,
    NetworkMode: networkMode,
    PortBindings: portBindings,
    Runtime: opts.runtime === `runsc` ? `runsc` : undefined,
    Binds: makeBinds(opts.extraMounts),
    Ulimits: [
      { Name: `nofile`, Soft: 1024, Hard: 2048 },
      { Name: `nproc`, Soft: 1024, Hard: 1024 },
    ],
    IpcMode: `none`,
  }

  const labels: Record<string, string> = {
    [SANDBOX_LABEL]: `1`,
    [SANDBOX_KEY_LABEL]: sandboxKey,
    [SANDBOX_PERSISTENT_LABEL]: persistent ? `true` : `false`,
    ...(opts.entityType
      ? { [SANDBOX_ENTITY_TYPE_LABEL]: opts.entityType }
      : {}),
    ...(opts.entityUrl ? { [SANDBOX_ENTITY_LABEL]: opts.entityUrl } : {}),
    ...(opts.labels ?? {}),
  }

  // Create-and-start a fresh container. Image is pulled here only (skipped
  // entirely when reattaching to an existing container).
  const createStarted = async (): Promise<DockerodeContainer> => {
    const image = resolveImage(opts)
    await ensureImage(docker, image, opts)
    const c = await docker.createContainer({
      // Spread (rather than a literal `name:`) so the `name` query param —
      // which dockerode accepts but doesn't declare on its create-opts type —
      // doesn't trip excess-property checking.
      ...{ name: containerName },
      Image: image,
      Cmd: [`sh`, `-c`, `while true; do sleep 3600; done`],
      WorkingDir: containerCwd,
      Env: Object.entries(baseEnv).map(([k, v]) => `${k}=${v}`),
      Labels: labels,
      ExposedPorts: exposedPorts,
      HostConfig,
    })
    try {
      await c.start()
    } catch (err) {
      await c.remove({ force: true, v: true }).catch(() => {})
      throw new SandboxError(
        `runtime`,
        `dockerSandbox: container start failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
    // Tmpfs on `/work` is empty at start; ensure caller-supplied workingDir
    // exists with sensible perms.
    await runOneOff(c, [`mkdir`, `-p`, containerCwd])
    return c
  }

  // Serialize reattach + registration against the debounced idle teardown
  // (which holds the same per-key lock), so a re-acquire can't race a teardown
  // that's already in flight.
  return withKeyLock(containerName, async () => {
    const live = sandboxContainers.get(containerName)
    if (live) {
      // An entry exists. If a teardown was pending (refs hit 0 during the
      // grace) cancel it and re-lease the still-live container.
      if (live.idleTimer) {
        clearTimeout(live.idleTimer)
        live.idleTimer = undefined
      }
      live.refs += 1
      return buildWrapper(live.container)
    }
    // No entry: an owner creates-or-reattaches; an attacher may only reattach to
    // an already-live container and never creates a fresh, empty one.
    const container = owner
      ? await reattachOrCreate(docker, containerName, createStarted)
      : await reattachExisting(docker, containerName)
    // The entry's `persistent` is the OWNER's idle intent. An attacher that
    // builds the entry (reattaching a container the owner left between wakes)
    // forces `persistent: true` so it can never wipe the owner's filesystem.
    sandboxContainers.set(containerName, {
      refs: 1,
      container,
      persistent: owner ? persistent : true,
      idleGraceMs,
    })
    return buildWrapper(container)
  })
}

/**
 * Resolve a container by name: reattach to an existing one (starting it if a
 * persistent container had been stopped) or create it fresh. Handles the race
 * where a concurrent caller creates the named container first (409).
 */
async function reattachOrCreate(
  docker: Dockerode,
  name: string,
  createStarted: () => Promise<DockerodeContainer>
): Promise<DockerodeContainer> {
  const existing = docker.getContainer(name)
  let running: boolean | null = null
  try {
    running = (await existing.inspect()).State.Running
  } catch {
    running = null
  }
  if (running !== null) {
    if (!running) {
      // A persistent container that was STOPPED on idle: its writable layer
      // (and thus the filesystem) survives, so restarting resumes the keepalive
      // and exec/fs round-trips work again.
      await existing.start().catch(() => {})
    }
    return existing
  }
  try {
    return await createStarted()
  } catch (err) {
    // Lost a create race — another lease just made it. Attach to theirs.
    if (isNameConflict(err)) {
      const c = docker.getContainer(name)
      await c.start().catch(() => {})
      return c
    }
    throw err
  }
}

/**
 * Reattach to an existing container WITHOUT creating one — the attacher path.
 * A non-owner can only ever join an already-live owner container; if none
 * exists (the owner never created it, or it was already torn down) we reject
 * with `unavailable` rather than conjuring a fresh, empty sandbox under the
 * shared key. A stopped (idle-preserved) owner container is restarted.
 */
async function reattachExisting(
  docker: Dockerode,
  name: string
): Promise<DockerodeContainer> {
  const existing = docker.getContainer(name)
  let running: boolean | null = null
  try {
    running = (await existing.inspect()).State.Running
  } catch {
    running = null
  }
  if (running === null) {
    throw new SandboxError(
      `unavailable`,
      `dockerSandbox: cannot attach — no owner sandbox is live for this key (container "${name}" does not exist). The owning entity must create it first.`
    )
  }
  if (!running) await existing.start().catch(() => {})
  return existing
}

function isNameConflict(err: unknown): boolean {
  const status = (err as { statusCode?: number; status?: number })?.statusCode
  if (status === 409) return true
  return /already in use|Conflict/i.test(
    err instanceof Error ? err.message : String(err)
  )
}

/**
 * One-shot startup cleanup of *ephemeral* sandbox leftovers from a previous
 * process (a crash or restart before disposes ran). Call once at runner boot.
 *
 * Two containers are deliberately left untouched:
 *  - RUNNING containers — they may belong to a live sibling runner (or a
 *    concurrent test run) sharing this Docker daemon; force-removing those
 *    would wipe another process's in-use sandbox. Reboot/crash leftovers are
 *    `Exited` once the daemon restarts, so the common case is still reclaimed;
 *    a still-running ephemeral orphan is left for a manual labelled prune
 *    rather than risk a live peer.
 *  - PERSISTENT containers — `persistent: true` exists precisely so a restarted
 *    process can reattach to the warm workspace by key, so they must survive a
 *    boot (only ephemeral leftovers are reclaimed here; a manual labelled prune
 *    reclaims truly-abandoned persistent ones).
 *
 * Returns the names removed.
 */
export async function sweepOrphanedDockerSandboxes(opts?: {
  dockerSocket?: string
}): Promise<Array<string>> {
  const Docker = await loadDockerode()
  const docker: Dockerode = opts?.dockerSocket
    ? new Docker({ socketPath: opts.dockerSocket })
    : new Docker()

  let listed: ReadonlyArray<{
    Id: string
    Names?: ReadonlyArray<string>
    State?: string
    Labels?: Record<string, string>
  }> = []
  try {
    listed = await docker.listContainers({
      all: true,
      filters: { label: [SANDBOX_LABEL] },
    })
  } catch {
    return []
  }

  const removed: Array<string> = []
  for (const c of listed) {
    const name = c.Names?.[0]?.replace(/^\//, ``) ?? c.Id
    // Never touch a running container (possibly a live peer) or a persistent
    // one (meant to be reattached by key). See the doc comment above.
    if (c.State === `running`) continue
    if (c.Labels?.[SANDBOX_PERSISTENT_LABEL] === `true`) continue
    try {
      await docker.getContainer(c.Id).remove({ force: true, v: true })
      removed.push(name)
    } catch {
      /* already gone */
    }
  }
  return removed
}

/** Test-only: drop the in-process container registry bookkeeping. */
export function __resetPersistentRegistryForTests(): void {
  for (const entry of sandboxContainers.values()) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
  }
  sandboxContainers.clear()
  keyLocks.clear()
}

function resolveImage(opts: DockerSandboxOpts): string {
  const image = opts.image ?? DEFAULT_IMAGE
  if (!opts.allowFloatingTag && !image.includes(`@sha256:`)) {
    throw new SandboxError(
      `runtime`,
      `dockerSandbox: image "${image}" lacks a digest pin. Either supply a digest (\`image@sha256:...\`) or pass allowFloatingTag: true.`
    )
  }
  return image
}

async function ensureImage(
  docker: Dockerode,
  image: string,
  opts: DockerSandboxOpts
): Promise<void> {
  // Best-effort: try the daemon's inspection by relying on createContainer
  // to surface the missing image as a 404. To keep the first-run experience
  // smooth on dev machines, we proactively pull when allowed.
  if (opts.pullIfMissing === false) return
  // dockerode's `pull` is idempotent; the daemon dedupes by digest.
  const stream = await docker.pull(image)
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err) => (err ? reject(err) : resolve()),
      opts.onPullProgress
    )
  })
}

function makePortBindings(
  ports: ReadonlyArray<number>
): Record<string, ReadonlyArray<{ HostIp?: string; HostPort?: string }>> {
  const out: Record<
    string,
    ReadonlyArray<{ HostIp?: string; HostPort?: string }>
  > = {}
  for (const p of ports) {
    // Bind to loopback only — on a dev laptop `0.0.0.0` would expose the
    // sandboxed service across the LAN, which is unexpected for an
    // isolation primitive.
    out[`${p}/tcp`] = [{ HostIp: `127.0.0.1`, HostPort: `` }]
  }
  return out
}

function makeExposedPortsObject(
  ports: ReadonlyArray<number>
): Record<string, Record<string, never>> {
  const out: Record<string, Record<string, never>> = {}
  for (const p of ports) out[`${p}/tcp`] = {}
  return out
}

function makeBinds(
  mounts: DockerSandboxOpts[`extraMounts`]
): ReadonlyArray<string> {
  if (!mounts || mounts.length === 0) return []
  const isDockerSock = (p: string): boolean => /docker\.sock(?:[/]|$)/.test(p)
  return mounts.map((m) => {
    // Check the literal path *and* its realpath: a symlink like
    // `/tmp/innocent -> /var/run/docker.sock` passes the string match but
    // resolves to the socket, handing the container an instant escape
    // primitive. realpath throws ENOENT for a not-yet-created mount path —
    // which can't be a symlink right now, so the literal check below stands.
    //
    // This is best-effort defense-in-depth: `extraMounts` is operator-supplied
    // config (not agent-controlled), and the resolved path isn't pinned — we
    // hand docker the literal `hostPath`, which the daemon re-resolves at mount
    // time. So if the path is materialized as a symlink to the socket in the
    // window between here and createContainer, safety rests on docker's own
    // resolution, not on this check. Negligible in practice: the spec is built
    // and consumed synchronously, and exploiting it needs host write access.
    let resolved = m.hostPath
    try {
      resolved = realpathSync(m.hostPath)
    } catch {
      // Path doesn't exist yet; docker would create it as an empty dir.
    }
    if (isDockerSock(m.hostPath) || isDockerSock(resolved)) {
      const via = resolved !== m.hostPath ? ` (resolves to "${resolved}")` : ``
      throw new SandboxError(
        `policy`,
        `dockerSandbox: refusing to mount Docker socket "${m.hostPath}"${via} — that would let sandboxed code create new containers and escape.`
      )
    }
    const readOnly = m.readOnly !== false
    return `${m.hostPath}:${m.containerPath}:${readOnly ? `ro` : `rw`}`
  })
}

interface RunOneOffResult {
  exitCode: number | null
  stdout: Buffer
  stderr: Buffer
}

/**
 * Read an exec's *final* exit code. The Docker daemon can still report
 * `Running: true` / `ExitCode: null` for a brief window after the output
 * stream closes but before the exec task is reaped, so a single `inspect()`
 * right after the stream ends intermittently yields a null exit code for a
 * command that exited cleanly. Poll until the exec is no longer running
 * (bounded) instead of trusting the first read. Returns `null` only if
 * `inspect()` throws (e.g. the container vanished).
 */
async function reapExec(
  ex: { inspect: () => Promise<{ ExitCode: number | null; Running: boolean }> },
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<{ ExitCode: number | null; Running: boolean } | null> {
  const deadline = Date.now() + (opts.timeoutMs ?? 2000)
  const intervalMs = opts.intervalMs ?? 20
  for (;;) {
    let info: { ExitCode: number | null; Running: boolean }
    try {
      info = await ex.inspect()
    } catch {
      return null
    }
    if (!info.Running || Date.now() >= deadline) return info
    await new Promise<void>((r) => {
      setTimeout(r, intervalMs)
    })
  }
}

async function runOneOff(
  container: DockerodeContainer,
  cmd: ReadonlyArray<string>
): Promise<RunOneOffResult> {
  const ex = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  })
  const stream = await ex.start({ hijack: true, stdin: false })
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdoutChunks: Array<Buffer> = []
  const stderrChunks: Array<Buffer> = []
  stdout.on(`data`, (b: Buffer) => stdoutChunks.push(b))
  stderr.on(`data`, (b: Buffer) => stderrChunks.push(b))
  // dockerode demuxes the framed Docker stream into stdout/stderr.
  await new Promise<void>((resolve) => {
    const containerAny = container as unknown as {
      modem: {
        demuxStream: (
          s: NodeJS.ReadableStream,
          o: NodeJS.WritableStream,
          e: NodeJS.WritableStream
        ) => void
      }
    }
    containerAny.modem.demuxStream(stream, stdout, stderr)
    stream.on(`end`, () => resolve())
    stream.on(`close`, () => resolve())
  })
  const info = await reapExec(ex)
  return {
    exitCode: info?.ExitCode ?? null,
    stdout: Buffer.concat(stdoutChunks),
    stderr: Buffer.concat(stderrChunks),
  }
}

class DockerSandbox implements Sandbox {
  readonly name: string
  readonly workingDirectory: string
  private container: DockerodeContainer
  private policy: NetworkPolicy
  private disposed = false
  private containerName: string
  /**
   * Whether this lease owns the container. Only an owner's dispose can reclaim
   * (wipe) it; an attacher's dispose merely releases its refcount. The
   * persistent/idle intent lives on the shared registry entry, not here, so
   * every lease agrees on the teardown action regardless of who disposes last.
   */
  private isOwner: boolean

  constructor(deps: {
    container: DockerodeContainer
    containerCwd: string
    policy: NetworkPolicy
    runtime: `runc` | `runsc`
    containerName: string
    owner: boolean
  }) {
    this.container = deps.container
    this.workingDirectory = deps.containerCwd
    this.policy = deps.policy
    this.name = `docker:${deps.runtime}`
    this.containerName = deps.containerName
    this.isOwner = deps.owner
  }

  async exec(opts: SandboxExecOpts): Promise<SandboxExecResult> {
    this.assertLive()
    // Unique per-exec marker. Children of this exec inherit it via the
    // environment, which lets a timeout/abort kill *only* this exec's process
    // tree — see `killExecTree`. Crucial for shared containers, where sibling
    // execs and background servers share the PID namespace.
    const execId = randomUUID()
    const env: Record<string, string> = {
      ...opts.env,
      __SBX_EXEC_ID: execId,
    }
    const ex = await this.container.exec({
      Cmd: [`sh`, `-c`, opts.command],
      WorkingDir: opts.cwd ?? this.workingDirectory,
      AttachStdin: opts.stdin !== undefined,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
    })

    const stream = (await ex.start({
      hijack: true,
      stdin: opts.stdin !== undefined,
    })) as NodeJS.ReadableStream & { end?: (data?: Buffer | string) => void }
    if (opts.stdin !== undefined && stream.end) {
      stream.end(opts.stdin)
    }

    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const stdoutChunks: Array<Buffer> = []
    const stderrChunks: Array<Buffer> = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let truncated = false
    const max = opts.maxOutputBytes ?? Number.POSITIVE_INFINITY

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

    stdout.on(
      `data`,
      collect(
        stdoutChunks,
        () => stdoutBytes,
        (n) => (stdoutBytes = n)
      )
    )
    stderr.on(
      `data`,
      collect(
        stderrChunks,
        () => stderrBytes,
        (n) => (stderrBytes = n)
      )
    )

    const containerAny = this.container as unknown as {
      modem: {
        demuxStream: (
          s: NodeJS.ReadableStream,
          o: NodeJS.WritableStream,
          e: NodeJS.WritableStream
        ) => void
      }
    }
    containerAny.modem.demuxStream(stream, stdout, stderr)

    let aborted = false
    let timedOut = false
    let inspected: { ExitCode: number | null; Running: boolean } | null = null

    const killExecTree = async () => {
      // Kill only *this* exec's process tree. Every process in it inherited the
      // unique `__SBX_EXEC_ID` we put in the exec's environment, so we find the
      // tree by scanning each /proc/<pid>/environ for the marker — leaving PID
      // 1, background servers, and sibling execs (different marker) untouched.
      // That's what makes a shared, multi-tenant container safe. We tag-and-find
      // rather than kill by PID because dockerode reports the exec's host-
      // namespace PID, which is meaningless inside the container. Killing the
      // tree includes the exec's root `sh`, so the hijacked stream unblocks.
      try {
        await runOneOff(this.container, [
          `sh`,
          `-c`,
          // environ is NUL-separated, so translate NUL→newline before matching
          // the marker as a whole line.
          `for p in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do ` +
            `[ "$p" = 1 ] && continue; ` +
            `tr '\\0' '\\n' < /proc/$p/environ 2>/dev/null | ` +
            `grep -qxF "__SBX_EXEC_ID=${execId}" && kill -KILL "$p" 2>/dev/null; ` +
            `done`,
        ])
      } catch {
        /* container may already be gone */
      }
    }

    let timer: NodeJS.Timeout | undefined
    if (opts.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true
        void killExecTree()
      }, opts.timeoutMs)
    }

    const onAbort = () => {
      aborted = true
      void killExecTree()
    }
    if (opts.signal) {
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener(`abort`, onAbort, { once: true })
    }
    const clearAbort = () => {
      if (opts.signal) opts.signal.removeEventListener(`abort`, onAbort)
    }

    // Race the natural stream close against a hard cutoff a few seconds
    // past the kill — dockerode occasionally leaks the connection.
    await new Promise<void>((resolve) => {
      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        resolve()
      }
      stream.on(`end`, settle)
      stream.on(`close`, settle)
      if (opts.timeoutMs !== undefined) {
        setTimeout(settle, opts.timeoutMs + 5000).unref()
      }
      if (opts.signal) {
        const force = () => setTimeout(settle, 3000).unref()
        if (opts.signal.aborted) force()
        else opts.signal.addEventListener(`abort`, force, { once: true })
      }
    })
    if (timer) clearTimeout(timer)
    clearAbort()
    // Poll until the exec is reaped so we don't read a transient null exit
    // code for a command that actually exited (see `reapExec`).
    inspected = await reapExec(ex)
    return {
      exitCode: inspected?.ExitCode ?? null,
      signal: null,
      stdout: Buffer.concat(stdoutChunks),
      stderr: Buffer.concat(stderrChunks),
      timedOut,
      aborted,
      outputTruncated: truncated,
    }
  }

  async readFile(path: string): Promise<Buffer> {
    this.assertLive()
    this.assertReadable(path)
    try {
      return await getFile(this.container, this.absolute(path))
    } catch (err) {
      throw wrapFsError(err, `readFile`, path)
    }
  }

  async writeFile(path: string, content: Buffer | string): Promise<void> {
    this.assertLive()
    this.assertWritable(path)
    try {
      await putFile(this.container, this.absolute(path), content)
    } catch (err) {
      throw wrapFsError(err, `writeFile`, path)
    }
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    this.assertLive()
    this.assertWritable(path)
    try {
      await makeDir(this.container, this.absolute(path), opts)
    } catch (err) {
      throw wrapFsError(err, `mkdir`, path)
    }
  }

  async readdir(path: string): Promise<ReadonlyArray<DirEntry>> {
    this.assertLive()
    this.assertReadable(path)
    try {
      return await readDir(
        (cmd) => runOneOff(this.container, cmd),
        this.absolute(path)
      )
    } catch (err) {
      throw wrapFsError(err, `readdir`, path)
    }
  }

  async exists(path: string): Promise<boolean> {
    this.assertLive()
    // Safe-probe semantics: false for missing AND policy-denied paths,
    // matching native/unrestricted. We don't expose the policy boundary
    // through this primitive.
    if (!this.isReadable(path)) return false
    try {
      return await pathExists(
        (cmd) => runOneOff(this.container, cmd),
        this.absolute(path)
      )
    } catch (err) {
      throw wrapFsError(err, `exists`, path)
    }
  }

  async remove(path: string, opts?: { recursive?: boolean }): Promise<void> {
    this.assertLive()
    this.assertWritable(path)
    try {
      await removePath(
        (cmd) => runOneOff(this.container, cmd),
        this.absolute(path),
        opts
      )
    } catch (err) {
      throw wrapFsError(err, `remove`, path)
    }
  }

  async stat(path: string): Promise<FileStat> {
    this.assertLive()
    this.assertReadable(path)
    try {
      return await statPath(
        (cmd) => runOneOff(this.container, cmd),
        this.absolute(path)
      )
    } catch (err) {
      throw wrapFsError(err, `stat`, path)
    }
  }

  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    this.assertLive()
    const url = typeof input === `string` ? new URL(input) : input
    // Enforce the egress policy here, at the tool boundary on the host,
    // *before* dispatching. Literal private / link-local / metadata IPs are
    // always refused (SSRF guard); otherwise the host must pass the policy.
    if (isPrivateOrLinkLocal(url.hostname)) {
      throw new SandboxError(
        `policy`,
        `dockerSandbox: host "${url.hostname}" denied — private / link-local / metadata addresses are not permitted.`
      )
    }
    if (!hostAllowedByPolicy(this.policy, url.hostname)) {
      throw new SandboxError(
        `policy`,
        `dockerSandbox: host "${url.hostname}" is not permitted by the sandbox network policy (mode: ${this.policy.mode}).`
      )
    }
    // The request is then issued directly from inside the container (no
    // in-container proxy). This host-side check governs the fetch tool only;
    // code run via exec has direct bridge egress unless the policy is
    // deny-all (NetworkMode=none, no interface).
    return fetchInSandbox((opts) => this.exec(opts), url, init)
  }

  async dispose(opts?: { reclaim?: boolean }): Promise<void> {
    if (this.disposed) return
    this.disposed = true

    // Release this lease. Each lease is its own wrapper but shares the registry
    // entry's refcount, so teardown only happens once the LAST lease drains —
    // a sibling wake, an inheriting subagent, or ongoing collaboration keeps it
    // warm meanwhile. The teardown ACTION is owner-governed:
    //  - an OWNER disposing with `reclaim` (its entity went terminal) marks the
    //    entry so the container is WIPED — even if persistent — once leases hit
    //    zero (an attacher can never set this);
    //  - otherwise the entry's owner-set `persistent` decides STOP vs REMOVE.
    const entry = sandboxContainers.get(this.containerName)
    if (!entry) return
    if (this.isOwner && opts?.reclaim) entry.reclaim = true
    entry.refs = Math.max(0, entry.refs - 1)
    if (entry.refs > 0) return
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    // Reclaim removes immediately (grace 0, still lock-serialized); otherwise
    // the owner's persistent intent picks stop (preserve) vs remove (wipe). The
    // owner gate is already folded into `entry.reclaim`, and an ephemeral
    // container wipes on last-lease-drain regardless of the last holder.
    const action: `stop` | `remove` = sandboxWipesOnDispose(
      entry.reclaim ?? false,
      entry.persistent
    )
      ? `remove`
      : `stop`
    const grace = entry.reclaim ? 0 : entry.idleGraceMs
    entry.idleTimer = scheduleIdleTeardown(this.containerName, grace, action)
  }

  private absolute(path: string): string {
    return absoluteSandboxPath(this.workingDirectory, path)
  }

  private isReadable(path: string): boolean {
    return isPathWithinSandbox(this.workingDirectory, path)
  }

  private assertReadable(path: string): void {
    if (!this.isReadable(path)) {
      throw new SandboxError(
        `policy`,
        `dockerSandbox: read access to "${path}" is denied (outside working directory ${this.workingDirectory}).`
      )
    }
  }

  private assertWritable(path: string): void {
    if (!isPathWithinSandbox(this.workingDirectory, path)) {
      throw new SandboxError(
        `policy`,
        `dockerSandbox: write access to "${path}" is denied (outside working directory ${this.workingDirectory}).`
      )
    }
  }

  private assertLive(): void {
    if (this.disposed) {
      throw new SandboxError(
        `runtime`,
        `dockerSandbox: operation called after dispose().`
      )
    }
  }
}

function wrapFsError(err: unknown, op: string, path: string): Error {
  if (err instanceof SandboxError) return err
  const e = err as NodeJS.ErrnoException
  return new SandboxError(
    `runtime`,
    `dockerSandbox.${op}("${path}") failed: ${e.code ?? ``} ${e.message ?? String(err)}`.trim()
  )
}
