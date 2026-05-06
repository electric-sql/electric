import fs from 'node:fs/promises'
import path from 'node:path'
import type { CredentialStore, OAuthClientInfo, OAuthTokens } from './types'

interface FileShape {
  tokens?: Record<string, OAuthTokens>
  clientInfo?: Record<string, OAuthClientInfo>
}

async function readSafe(file: string): Promise<FileShape> {
  try {
    const stat = await fs.stat(file)
    if ((stat.mode & 0o777) !== 0o600) {
      throw new Error(
        `${file} has permissions ${(stat.mode & 0o777).toString(8)}; refusing to read (require 0600). Check file permissions.`
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

export interface FileCredentialStoreOptions {
  /** Reserved for future use: layer AES-256-GCM encryption when a keychain key is available. */
  encrypt?: { key: Buffer }
}

export function fileCredentialStore(
  file: string,
  _opts: FileCredentialStoreOptions = {}
): CredentialStore {
  return {
    async getOAuthTokens(server) {
      const data = await readSafe(file)
      return data.tokens?.[server]
    },
    async saveOAuthTokens(server, tokens) {
      const data = await readSafe(file)
      data.tokens = { ...(data.tokens ?? {}), [server]: tokens }
      await writeSafe(file, data)
    },
    async getOAuthClientInfo(server) {
      const data = await readSafe(file)
      return data.clientInfo?.[server]
    },
    async saveOAuthClientInfo(server, info) {
      const data = await readSafe(file)
      data.clientInfo = { ...(data.clientInfo ?? {}), [server]: info }
      await writeSafe(file, data)
    },
  }
}
