import { spawn } from 'node:child_process'
import type { OAuthClientInfo, OAuthTokens } from '../types'

// Native-free OS keychain bridge. Shells out to the platform's bundled
// keychain CLI; no node-gyp build, no binary to ship.
//   macOS  → /usr/bin/security
//   Linux  → secret-tool (from `libsecret-tools`)
//   Win    → not implemented yet (follow-up)

interface RunResult {
  stdout: string
  stderr: string
  code: number | null
}

async function run(
  cmd: string,
  args: string[],
  stdin?: string
): Promise<RunResult> {
  return new Promise((resolve) => {
    // Cast to NodeJS.EventEmitter — TS in this repo's lib config narrows
    // ChildProcess to a DOM-flavoured shape that drops the `on` overload.
    const proc = spawn(cmd, args, {
      stdio: [`pipe`, `pipe`, `pipe`],
    }) as unknown as NodeJS.EventEmitter & {
      stdout: NodeJS.ReadableStream
      stderr: NodeJS.ReadableStream
      stdin: NodeJS.WritableStream
    }
    const out: Buffer[] = []
    const err: Buffer[] = []
    proc.stdout.on(`data`, (b: Buffer) => {
      out.push(b)
    })
    proc.stderr.on(`data`, (b: Buffer) => {
      err.push(b)
    })
    proc.on(`error`, (e: Error) => {
      resolve({ stdout: ``, stderr: e.message, code: -1 })
    })
    proc.on(`close`, (code: number | null) => {
      resolve({
        stdout: Buffer.concat(out).toString(`utf8`),
        stderr: Buffer.concat(err).toString(`utf8`),
        code,
      })
    })
    if (stdin != null) proc.stdin.end(stdin)
    else proc.stdin.end()
  })
}

interface KeychainBackend {
  get(service: string, account: string): Promise<string | undefined>
  set(service: string, account: string, value: string): Promise<void>
}

// ── macOS ────────────────────────────────────────────────────────────
// `security` is at /usr/bin/security on every Mac; talks to Keychain
// Services. find-generic-password -w prints the password to stdout.
// add-generic-password -U upserts. Exit code 44 = item not found.
const macosBackend: KeychainBackend = {
  async get(service, account) {
    const r = await run(`security`, [
      `find-generic-password`,
      `-s`,
      service,
      `-a`,
      account,
      `-w`,
    ])
    if (r.code === 0) return r.stdout.replace(/\n$/, ``)
    if (/could not be found/i.test(r.stderr)) return undefined
    throw new Error(`security find-generic-password failed: ${r.stderr.trim()}`)
  },
  async set(service, account, value) {
    const r = await run(`security`, [
      `add-generic-password`,
      `-s`,
      service,
      `-a`,
      account,
      `-w`,
      value,
      `-U`,
    ])
    if (r.code !== 0) {
      throw new Error(
        `security add-generic-password failed: ${r.stderr.trim()}`
      )
    }
  },
}

// ── Linux (libsecret) ────────────────────────────────────────────────
// secret-tool comes from the libsecret-tools package on most distros.
// It talks to whatever Secret Service implementation is running
// (gnome-keyring, ksecretservice, KeePassXC's secret-service module).
// `lookup` prints the secret to stdout; `store` reads it from stdin.
// Exit 1 from `lookup` means "not found" (no separate code), so we
// rely on stderr being empty for that case.
const linuxBackend: KeychainBackend = {
  async get(service, account) {
    const r = await run(`secret-tool`, [
      `lookup`,
      `service`,
      service,
      `account`,
      account,
    ])
    if (r.code === 0) return r.stdout.replace(/\n$/, ``)
    if (r.code === 1 && r.stderr.trim() === ``) return undefined
    throw new Error(`secret-tool lookup failed: ${r.stderr.trim()}`)
  },
  async set(service, account, value) {
    const r = await run(
      `secret-tool`,
      [
        `store`,
        `--label`,
        `${service}/${account}`,
        `service`,
        service,
        `account`,
        account,
      ],
      value
    )
    if (r.code !== 0) {
      throw new Error(`secret-tool store failed: ${r.stderr.trim()}`)
    }
  },
}

function pickBackend(): KeychainBackend | undefined {
  if (process.platform === `darwin`) return macosBackend
  if (process.platform === `linux`) return linuxBackend
  // win32 (and anything else) — TODO: add Windows Credential Manager
  // bridge via `cmdkey`/PowerShell. For now, no-op gracefully so the
  // OAuth flow still works for the lifetime of the process.
  return undefined
}

export interface KeychainPersistenceOpts {
  /** Server name; used as the account-id portion of the keychain entry. */
  server: string
  /** Keychain service identifier. Default `'electric-agents'`. */
  service?: string
  /** Override for tests — inject a backend instead of shelling out. */
  backend?: KeychainBackend
}

/**
 * Opt-in helper for OAuth-mode `auth` configs. Loads any persisted tokens
 * and DCR client info from the OS keychain on startup, and returns the
 * matching `onTokensChanged` / `onClientRegistered` callbacks so the SDK
 * writes refreshed material back.
 *
 *   const honeycomb = await keychainPersistence({ server: 'honeycomb' })
 *   await mcpRegistry.addServer({
 *     name: 'honeycomb',
 *     transport: 'http',
 *     url: 'https://mcp.honeycomb.io/mcp',
 *     auth: {
 *       mode: 'authorizationCode',
 *       flow: 'browser',
 *       scopes: ['mcp:read'],
 *       ...honeycomb,
 *     },
 *   })
 *
 * Backend is chosen by `process.platform`:
 *   - darwin → `/usr/bin/security` (no extra deps)
 *   - linux  → `secret-tool` from libsecret-tools (apt: libsecret-tools)
 *   - win32  → not implemented yet — falls back to no-op callbacks
 *
 * If the chosen CLI isn't installed (e.g. minimal Linux container without
 * libsecret), reads/writes throw on first use; the registry surfaces
 * that as a connect-time error and the OAuth flow continues without
 * persistence.
 */
export async function keychainPersistence(
  opts: KeychainPersistenceOpts
): Promise<{
  tokens?: OAuthTokens
  client?: OAuthClientInfo
  onTokensChanged: (t: OAuthTokens) => Promise<void>
  onClientRegistered: (c: OAuthClientInfo) => Promise<void>
}> {
  const service = opts.service ?? `electric-agents`
  const backend = opts.backend ?? pickBackend()

  if (!backend) {
    console.warn(
      `[agents-mcp] keychainPersistence: ${process.platform} not supported yet — ${opts.server} OAuth tokens will not persist`
    )
    return {
      onTokensChanged: async () => {},
      onClientRegistered: async () => {},
    }
  }

  const [tokensRaw, clientRaw] = await Promise.all([
    backend.get(service, `tokens:${opts.server}`),
    backend.get(service, `client:${opts.server}`),
  ])

  return {
    tokens: tokensRaw ? (JSON.parse(tokensRaw) as OAuthTokens) : undefined,
    client: clientRaw ? (JSON.parse(clientRaw) as OAuthClientInfo) : undefined,
    onTokensChanged: async (t) => {
      await backend.set(service, `tokens:${opts.server}`, JSON.stringify(t))
    },
    onClientRegistered: async (c) => {
      await backend.set(service, `client:${opts.server}`, JSON.stringify(c))
    },
  }
}
