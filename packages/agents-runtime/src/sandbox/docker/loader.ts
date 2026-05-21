import { SandboxError } from '../types'

/**
 * Strongly-typed surface of `dockerode` we depend on. We avoid importing the
 * package type-side because it's an optional peer dependency and we don't
 * want our consumers' typecheckers to fail when dockerode is absent.
 */
export interface Dockerode {
  ping(): Promise<unknown>
  version(): Promise<{ ApiVersion?: string; Version?: string }>
  createContainer(opts: DockerContainerCreateOpts): Promise<DockerodeContainer>
  getContainer(id: string): DockerodeContainer
  listContainers(opts?: {
    all?: boolean
    filters?: Record<string, ReadonlyArray<string>>
  }): Promise<ReadonlyArray<{ Id: string }>>
  pull(image: string, opts?: unknown): Promise<NodeJS.ReadableStream>
  modem: {
    followProgress(
      stream: NodeJS.ReadableStream,
      onFinished: (err: Error | null) => void,
      onProgress?: (event: unknown) => void
    ): void
    demuxStream(
      raw: NodeJS.ReadableStream,
      stdout: NodeJS.WritableStream,
      stderr: NodeJS.WritableStream
    ): void
  }
}

export interface DockerContainerCreateOpts {
  Image: string
  Cmd?: ReadonlyArray<string>
  WorkingDir?: string
  Env?: ReadonlyArray<string>
  Labels?: Record<string, string>
  ExposedPorts?: Record<string, Record<string, never>>
  HostConfig: DockerHostConfig
  Tty?: boolean
}

export interface DockerHostConfig {
  AutoRemove?: boolean
  ReadonlyRootfs?: boolean
  Tmpfs?: Record<string, string>
  CapDrop?: ReadonlyArray<string>
  CapAdd?: ReadonlyArray<string>
  SecurityOpt?: ReadonlyArray<string>
  Privileged?: boolean
  PidsLimit?: number
  Memory?: number
  MemorySwap?: number
  NanoCpus?: number
  NetworkMode?: string
  ExtraHosts?: ReadonlyArray<string>
  PortBindings?: Record<
    string,
    ReadonlyArray<{ HostIp?: string; HostPort?: string }>
  >
  Runtime?: string
  Binds?: ReadonlyArray<string>
  Ulimits?: ReadonlyArray<{ Name: string; Soft: number; Hard: number }>
  IpcMode?: string
}

export interface DockerodeContainer {
  readonly id: string
  start(): Promise<unknown>
  stop(opts?: { t?: number }): Promise<unknown>
  kill(opts?: { signal?: string }): Promise<unknown>
  remove(opts?: { force?: boolean; v?: boolean }): Promise<unknown>
  inspect(): Promise<DockerInspectResult>
  exec(opts: {
    Cmd: ReadonlyArray<string>
    WorkingDir?: string
    Env?: ReadonlyArray<string>
    AttachStdin?: boolean
    AttachStdout?: boolean
    AttachStderr?: boolean
    Tty?: boolean
    User?: string
  }): Promise<DockerodeExec>
  getArchive(opts: { path: string }): Promise<NodeJS.ReadableStream>
  putArchive(
    tarStream: NodeJS.ReadableStream | Buffer,
    opts: { path: string }
  ): Promise<unknown>
}

export interface DockerodeExec {
  readonly id: string
  start(opts: {
    hijack?: boolean
    stdin?: boolean
    Tty?: boolean
  }): Promise<
    NodeJS.ReadableStream & { end?: (data?: Buffer | string) => void }
  >
  inspect(): Promise<{ ExitCode: number | null; Pid: number; Running: boolean }>
}

export interface DockerInspectResult {
  Id: string
  State: { Running: boolean; Pid: number }
  NetworkSettings: {
    Ports: Record<
      string,
      ReadonlyArray<{ HostIp: string; HostPort: string }> | null
    >
  }
  Config?: { Image?: string }
}

type DockerCtor = new (opts?: {
  socketPath?: string
  host?: string
  port?: number
  protocol?: string
}) => Dockerode

let cachedAvailability: boolean | null = null

export async function loadDockerode(): Promise<DockerCtor> {
  try {
    const mod = (await import(`dockerode`)) as unknown as {
      default?: DockerCtor
    }
    return (mod.default ?? (mod as unknown as DockerCtor)) as DockerCtor
  } catch {
    throw new SandboxError(
      `unavailable`,
      `dockerSandbox requires the "dockerode" package. Install it: pnpm add dockerode @types/dockerode`
    )
  }
}

/**
 * Cheap probe used by tests and `chooseDefaultSandbox`-like helpers. Caches
 * the first result to avoid repeated socket connections during a test run.
 */
export async function isDockerAvailable(): Promise<boolean> {
  if (cachedAvailability !== null) return cachedAvailability
  try {
    const Docker = await loadDockerode()
    const d = new Docker()
    await Promise.race([
      d.ping(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`docker ping timeout`)), 1000)
      ),
    ])
    cachedAvailability = true
  } catch {
    cachedAvailability = false
  }
  return cachedAvailability
}

/** For tests that need to flip the cache (e.g. simulating daemon-down). */
export function _resetDockerAvailabilityCache(): void {
  cachedAvailability = null
}
