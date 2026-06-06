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
  kill(): Promise<void>
  /**
   * State-preserving teardown for a persistent workspace. Rather than killing
   * the VM, hand its lifecycle back to the provider (e.g. stop the keep-alive
   * heartbeat so the provider auto-suspends it on idle) so its filesystem and,
   * where supported, memory/process state survive for a later wake — or a
   * collaborator on another host — to reattach by key. `remoteSandbox` calls
   * this from `dispose()` only when the sandbox is `persistent`; ephemeral
   * sandboxes always `kill()`. Optional: clients that don't distinguish fall
   * back to `kill()`.
   */
  suspend?(): Promise<void>
}
