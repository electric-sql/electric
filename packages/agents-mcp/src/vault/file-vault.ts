import { readFile, writeFile, chmod, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { KeyVault } from './types'
import { decryptWithKey, encryptWithKey, generateVaultKey } from './keychain'

interface Entry {
  secret: string
  expiresAt?: string
}
type Store = Record<string, Entry>

export interface FileVaultOptions {
  keyPath?: string
  key?: Buffer
}

async function read(path: string): Promise<Store> {
  try {
    return JSON.parse(await readFile(path, `utf8`)) as Store
  } catch (err) {
    if (
      err instanceof Error &&
      `code` in err &&
      (err as NodeJS.ErrnoException).code === `ENOENT`
    ) {
      return {}
    }
    throw err
  }
}

async function write(path: string, store: Store): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(store, null, 2), { mode: 0o600 })
  await chmod(path, 0o600)
}

async function loadOrCreateKey(keyPath: string): Promise<Buffer> {
  try {
    const b64 = await readFile(keyPath, `utf8`)
    return Buffer.from(b64.trim(), `base64`)
  } catch (err) {
    if (
      err instanceof Error &&
      `code` in err &&
      (err as NodeJS.ErrnoException).code === `ENOENT`
    ) {
      const key = generateVaultKey()
      await mkdir(dirname(keyPath), { recursive: true })
      await writeFile(keyPath, key.toString(`base64`), { mode: 0o600 })
      await chmod(keyPath, 0o600)
      return key
    }
    throw err
  }
}

export function createFileVault(
  path: string,
  opts: FileVaultOptions = {}
): KeyVault {
  let cachedKey: Buffer | undefined = opts.key
  const keyPath = opts.keyPath

  async function resolveKey(): Promise<Buffer | undefined> {
    if (cachedKey) return cachedKey
    if (keyPath) {
      cachedKey = await loadOrCreateKey(keyPath)
      return cachedKey
    }
    return undefined
  }

  return {
    async get(ref) {
      const s = await read(path)
      const stored = s[ref]?.secret
      if (stored == null) return null
      const key = await resolveKey()
      if (!key) return stored
      return decryptWithKey(stored, key)
    },
    async set(ref, secret, opts) {
      const s = await read(path)
      const key = await resolveKey()
      const stored = key ? encryptWithKey(secret, key) : secret
      s[ref] = {
        secret: stored,
        ...(opts?.expiresAt ? { expiresAt: opts.expiresAt.toISOString() } : {}),
      }
      await write(path, s)
    },
    async delete(ref) {
      const s = await read(path)
      delete s[ref]
      await write(path, s)
    },
    async list(prefix = ``) {
      const s = await read(path)
      return Object.entries(s)
        .filter(([k]) => k.startsWith(prefix))
        .map(([ref, v]) => ({
          ref,
          ...(v.expiresAt ? { expiresAt: new Date(v.expiresAt) } : {}),
        }))
    },
  }
}
