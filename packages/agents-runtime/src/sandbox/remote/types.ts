import type { DirEntry, FileStat } from '../types'

/**
 * Minimal interface our remote-sandbox adapter expects from a provider's
 * SDK. Each provider adapter (e2b, vercel) implements this and the rest
 * of remoteSandbox is provider-agnostic. Tests pass a fake client directly
 * via the `client` option, so no real SDK is required.
 */
export interface RemoteSandboxClient {
  exec(opts: {
    command: string
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
    stdin?: Buffer | string
  }): Promise<{
    stdout: Buffer
    stderr: Buffer
    exitCode: number | null
    signal?: string | null
    timedOut?: boolean
  }>
  readFile(path: string): Promise<Buffer>
  writeFile(path: string, content: Buffer | string): Promise<void>
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>
  readdir(path: string): Promise<ReadonlyArray<DirEntry>>
  exists(path: string): Promise<boolean>
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>
  stat(path: string): Promise<FileStat>
  /**
   * Public URL the host can hit to reach a server bound to `port` inside
   * the remote workspace. Providers may return either a plain host:port
   * string or a fully-qualified URL; the remote-sandbox adapter assembles
   * the final URL with the requested protocol if the response is bare.
   */
  getUrl?(opts: { port: number; protocol?: `http` | `https` }): Promise<string>
  kill(): Promise<void>
}
