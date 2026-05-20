import { PassThrough } from 'node:stream'
import { posix } from 'node:path'
import { ProxyAgent, type Dispatcher } from 'undici'
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
import { startAllowlistProxy, type AllowlistProxy } from './docker/proxy'

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
   * Container ports that should be published to the host. Required for
   * `getUrl` to work — ports not listed here will reject with
   * `unavailable`.
   */
  readonly exposedPorts?: ReadonlyArray<number>
  readonly extraMounts?: ReadonlyArray<{
    readonly hostPath: string
    readonly containerPath: string
    /** Literal `true` — `:rw` is intentionally unreachable. */
    readonly readOnly: true
  }>
  readonly dockerSocket?: string
  readonly labels?: Readonly<Record<string, string>>
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

const HOST_GATEWAY_ALIAS = `host.docker.internal`

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

  const image = resolveImage(opts)
  await ensureImage(docker, image, opts)

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

  // Proxy is started only when the container is granted network. A
  // network=none container has no path to host.docker.internal anyway,
  // so the proxy would be unreachable.
  const networkRequested =
    initialPolicy.mode !== `deny-all` ||
    (opts.exposedPorts !== undefined && opts.exposedPorts.length > 0)
  const proxy: AllowlistProxy | null = networkRequested
    ? await startAllowlistProxy(initialPolicy)
    : null

  const networkMode = networkRequested ? `bridge` : `none`

  const baseEnv: Record<string, string> = {
    HOME: `/work`,
    ...opts.env,
  }
  if (proxy) {
    const proxyUrlForContainer = proxy.url.replace(
      `127.0.0.1`,
      HOST_GATEWAY_ALIAS
    )
    baseEnv.HTTP_PROXY = proxyUrlForContainer
    baseEnv.HTTPS_PROXY = proxyUrlForContainer
    baseEnv.http_proxy = proxyUrlForContainer
    baseEnv.https_proxy = proxyUrlForContainer
    baseEnv.NO_PROXY = `localhost,127.0.0.1`
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
  // strict ulimits, resource caps, ephemeral container. Operators who
  // want RO rootfs should also stop using sandbox.writeFile / mkdir and
  // do all writes via sandbox.exec (echo > /work/...) which goes through
  // the container's own mount namespace and respects the tmpfs.
  const HostConfig = {
    AutoRemove: true,
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
    ExtraHosts: networkRequested ? [`${HOST_GATEWAY_ALIAS}:host-gateway`] : [],
    PortBindings: portBindings,
    Runtime: opts.runtime === `runsc` ? `runsc` : undefined,
    Binds: makeBinds(opts.extraMounts),
    Ulimits: [
      { Name: `nofile`, Soft: 1024, Hard: 2048 },
      { Name: `nproc`, Soft: 1024, Hard: 1024 },
    ],
    IpcMode: `none`,
  }

  const container = await docker.createContainer({
    Image: image,
    Cmd: [`sh`, `-c`, `while true; do sleep 3600; done`],
    WorkingDir: containerCwd,
    Env: Object.entries(baseEnv).map(([k, v]) => `${k}=${v}`),
    Labels: { 'com.electric.sandbox': `1`, ...(opts.labels ?? {}) },
    ExposedPorts: exposedPorts,
    HostConfig,
  })
  try {
    await container.start()
  } catch (err) {
    await container.remove({ force: true, v: true }).catch(() => {})
    if (proxy) await proxy.close()
    throw new SandboxError(
      `runtime`,
      `dockerSandbox: container start failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }

  // Tmpfs on `/work` is empty at start; ensure caller-supplied workingDir
  // exists with sensible perms.
  await runOneOff(container, [`mkdir`, `-p`, containerCwd])

  return new DockerSandbox({
    container,
    containerCwd,
    proxy,
    runtime: opts.runtime ?? `runc`,
    exposedPortsSet: new Set(opts.exposedPorts ?? []),
    initialPolicy,
  })
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
): Record<string, ReadonlyArray<{ HostPort?: string }>> {
  const out: Record<string, ReadonlyArray<{ HostPort?: string }>> = {}
  for (const p of ports) {
    out[`${p}/tcp`] = [{ HostPort: `` }]
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
  return mounts.map((m) => {
    if (/docker\.sock(?:[/]|$)/.test(m.hostPath)) {
      throw new SandboxError(
        `policy`,
        `dockerSandbox: refusing to mount Docker socket "${m.hostPath}" — that would let sandboxed code create new containers and escape.`
      )
    }
    // Literal `true` enforced by the type system; defensive runtime check too.
    if ((m.readOnly as unknown) !== true) {
      throw new SandboxError(
        `policy`,
        `dockerSandbox: extraMounts entries must be {readOnly: true}.`
      )
    }
    return `${m.hostPath}:${m.containerPath}:ro`
  })
}

interface RunOneOffResult {
  exitCode: number | null
  stdout: Buffer
  stderr: Buffer
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
  const info = await ex.inspect()
  return {
    exitCode: info.ExitCode,
    stdout: Buffer.concat(stdoutChunks),
    stderr: Buffer.concat(stderrChunks),
  }
}

class DockerSandbox implements Sandbox {
  readonly name: string
  readonly workingDirectory: string
  private container: DockerodeContainer
  private proxy: AllowlistProxy | null
  private fetchDispatcher: Dispatcher | null = null
  private disposed = false
  private currentPolicy: NetworkPolicy
  private exposedPorts: Set<number>

  constructor(deps: {
    container: DockerodeContainer
    containerCwd: string
    proxy: AllowlistProxy | null
    runtime: `runc` | `runsc`
    exposedPortsSet: Set<number>
    initialPolicy: NetworkPolicy
  }) {
    this.container = deps.container
    this.workingDirectory = deps.containerCwd
    this.proxy = deps.proxy
    this.name = `docker:${deps.runtime}`
    this.currentPolicy = deps.initialPolicy
    this.exposedPorts = deps.exposedPortsSet
    if (this.proxy) {
      this.fetchDispatcher = new ProxyAgent(this.proxy.url)
    }
  }

  async exec(opts: SandboxExecOpts): Promise<SandboxExecResult> {
    this.assertLive()
    const env: Record<string, string> = { ...opts.env }
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
    let inspected: {
      ExitCode: number | null
      Pid: number
      Running: boolean
    } | null = null

    const killEverything = async () => {
      // We can't reliably resolve the exec's PID to a container-namespace
      // PID (Docker's inspect Pid is host-side and may be unhelpful from
      // inside the container), and even when we can, the original exec
      // stream sometimes doesn't unblock cleanly. The blunt fix: kill
      // *every* process in the container's PID namespace except PID 1
      // (the keepalive). This is safe because the container is single-
      // tenant (one Sandbox = one container).
      try {
        await runOneOff(this.container, [
          `sh`,
          `-c`,
          // `kill -KILL -1` would also kill PID 1; instead enumerate
          // /proc and skip PID 1 and our own kill helper. Then sleep
          // a hair so any forwarded SIGTERM is observed.
          `for p in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do [ "$p" = "1" ] || [ "$p" = "$$" ] || kill -KILL "$p" 2>/dev/null; done`,
        ])
      } catch {
        /* container may already be gone */
      }
    }

    let timer: NodeJS.Timeout | undefined
    if (opts.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true
        void killEverything()
      }, opts.timeoutMs)
    }

    const onAbort = () => {
      aborted = true
      void killEverything()
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
    try {
      inspected = await ex.inspect()
    } catch {
      inspected = null
    }
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
    if (!this.proxy) {
      const url = typeof input === `string` ? new URL(input) : input
      throw new SandboxError(
        `policy`,
        `dockerSandbox: host "${url.hostname}" denied — sandbox is in deny-all mode (no proxy started). Call updateNetworkPolicy to open egress.`
      )
    }
    try {
      const response = await globalThis.fetch(input as RequestInfo, {
        ...init,
        // @ts-expect-error undici dispatcher option not in std lib.dom.d.ts
        dispatcher: this.fetchDispatcher ?? undefined,
      })
      if (response.status === 403) {
        const denied = response.headers.get(`x-sandbox-denied`)
        if (denied) {
          throw new SandboxError(
            `policy`,
            `dockerSandbox: proxy denied request (${denied})`
          )
        }
      }
      return response
    } catch (err) {
      if (err instanceof SandboxError) throw err
      const url = typeof input === `string` ? new URL(input) : input
      throw new SandboxError(
        `policy`,
        `dockerSandbox: fetch to "${url.hostname}" was rejected by the sandbox proxy (${
          err instanceof Error ? err.message : String(err)
        })`
      )
    }
  }

  async getUrl(opts: {
    port: number
    protocol?: `http` | `https`
  }): Promise<string> {
    this.assertLive()
    if (!this.exposedPorts.has(opts.port)) {
      throw new SandboxError(
        `unavailable`,
        `dockerSandbox: port ${opts.port} is not in exposedPorts; pass it at construction time.`
      )
    }
    const info = await this.container.inspect()
    const mapping = info.NetworkSettings.Ports[`${opts.port}/tcp`]
    if (!mapping || mapping.length === 0) {
      throw new SandboxError(
        `unavailable`,
        `dockerSandbox: container has no host binding for port ${opts.port}.`
      )
    }
    return `${opts.protocol ?? `http`}://localhost:${mapping[0].HostPort}`
  }

  async updateNetworkPolicy(policy: NetworkPolicy): Promise<void> {
    this.currentPolicy = policy
    if (!this.proxy) {
      // The container has NetworkMode=none; mid-session policy changes
      // cannot grant egress without recreating the container. Surface
      // that to the caller.
      if (policy.mode !== `deny-all`) {
        throw new SandboxError(
          `unavailable`,
          `dockerSandbox: cannot upgrade a network=none container's policy mid-session. Recreate the sandbox with an initialNetworkPolicy that requests network.`
        )
      }
      return
    }
    this.proxy.updatePolicy(policy)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.fetchDispatcher) {
      try {
        await this.fetchDispatcher.close()
      } catch {
        /* ignore */
      }
      this.fetchDispatcher = null
    }
    if (this.proxy) {
      try {
        await this.proxy.close()
      } catch {
        /* ignore */
      }
      this.proxy = null
    }
    try {
      await this.container.kill({ signal: `SIGKILL` })
    } catch {
      /* may already be gone */
    }
    try {
      await this.container.remove({ force: true, v: true })
    } catch {
      /* AutoRemove may have raced us */
    }
  }

  private absolute(path: string): string {
    return path.startsWith(`/`)
      ? path
      : posix.resolve(this.workingDirectory, path)
  }

  private assertWritable(path: string): void {
    const abs = this.absolute(path)
    const rel = posix.relative(this.workingDirectory, abs)
    if (rel.startsWith(`..`) || rel === `..`) {
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
