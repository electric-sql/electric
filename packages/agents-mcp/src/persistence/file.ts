import fs from 'node:fs/promises'
import path from 'node:path'
import type { OAuthClientInfo, OAuthTokens } from '../types'

interface FileShape {
  tokens?: Record<string, OAuthTokens>
  client?: Record<string, OAuthClientInfo>
}

async function readSafe(file: string): Promise<FileShape> {
  try {
    const stat = await fs.stat(file)
    if ((stat.mode & 0o777) !== 0o600) {
      throw new Error(
        `${file} has permissions ${(stat.mode & 0o777).toString(8)}; refusing to read (require 0600).`
      )
    }
    const text = await fs.readFile(file, `utf-8`)
    return text.trim() ? (JSON.parse(text) as FileShape) : {}
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === `ENOENT`) return {}
    throw err
  }
}

async function writeSafe(file: string, data: FileShape): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  await fs.rename(tmp, file)
  await fs.chmod(file, 0o600)
}

export interface FilePersistenceOpts {
  /** Path on disk; mode-0600 JSON. Created on first write. */
  path: string
  /** Server name (key inside the file). */
  server: string
}

/**
 * Opt-in helper for OAuth-mode `auth` configs. Mirrors `keychainPersistence`
 * but persists to a JSON file on disk (mode 0600). Right tool when no OS
 * keychain is available — CI runners, minimal Linux containers, etc.
 *
 *   const honeycomb = await filePersistence({
 *     path: './.electric-agents/credentials.json',
 *     server: 'honeycomb',
 *   })
 *   await mcpRegistry.addServer({ ..., auth: { ..., ...honeycomb } })
 */
export async function filePersistence(opts: FilePersistenceOpts): Promise<{
  tokens?: OAuthTokens
  client?: OAuthClientInfo
  onTokensChanged: (t: OAuthTokens) => Promise<void>
  onClientRegistered: (c: OAuthClientInfo) => Promise<void>
}> {
  const data = await readSafe(opts.path)
  return {
    tokens: data.tokens?.[opts.server],
    client: data.client?.[opts.server],
    onTokensChanged: async (t) => {
      const cur = await readSafe(opts.path)
      cur.tokens = { ...(cur.tokens ?? {}), [opts.server]: t }
      await writeSafe(opts.path, cur)
    },
    onClientRegistered: async (c) => {
      const cur = await readSafe(opts.path)
      cur.client = { ...(cur.client ?? {}), [opts.server]: c }
      await writeSafe(opts.path, cur)
    },
  }
}
