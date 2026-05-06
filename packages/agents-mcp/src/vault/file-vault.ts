import { readFile, writeFile, chmod, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { KeyVault } from './types'

interface Entry {
  secret: string
  expiresAt?: string
}
type Store = Record<string, Entry>

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
  await writeFile(path, JSON.stringify(store, null, 2))
  await chmod(path, 0o600)
}

export function createFileVault(path: string): KeyVault {
  return {
    async get(ref) {
      const s = await read(path)
      return s[ref]?.secret ?? null
    },
    async set(ref, secret, opts) {
      const s = await read(path)
      s[ref] = {
        secret,
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
