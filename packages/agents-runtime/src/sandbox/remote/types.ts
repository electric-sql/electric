/**
 * Minimal interface our remote-sandbox adapter expects from a provider's
 * SDK. Each provider adapter (e2b, vercel) implements this and the rest
 * of remoteSandbox is provider-agnostic. The shape is deliberately narrow:
 * exec, three FS operations, and a teardown. Tests pass a fake client
 * directly via the `client` option, so no real SDK is required.
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
  kill(): Promise<void>
}
