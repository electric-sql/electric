import { safeStorage } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

type SecretEnvelope = {
  version: 1
  secrets: Record<string, string>
}

const EMPTY: SecretEnvelope = { version: 1, secrets: {} }

function cloneEmpty(): SecretEnvelope {
  return { version: EMPTY.version, secrets: {} }
}

export class SecretStore {
  private cache: SecretEnvelope | null = null

  constructor(private readonly filePath: string) {}

  async get(ref: string): Promise<string | null> {
    const envelope = await this.load()
    const encrypted = envelope.secrets[ref]
    if (!encrypted) return null
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, `base64`))
    } catch (error) {
      console.warn(`[agents-desktop] failed to decrypt secret ${ref}:`, error)
      return null
    }
  }

  async set(ref: string, value: string): Promise<void> {
    const envelope = await this.load()
    envelope.secrets[ref] = safeStorage.encryptString(value).toString(`base64`)
    await this.persist(envelope)
  }

  async delete(ref: string): Promise<void> {
    const envelope = await this.load()
    delete envelope.secrets[ref]
    await this.persist(envelope)
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const envelope = await this.load()
    let deleted = 0
    for (const ref of Object.keys(envelope.secrets)) {
      if (!ref.startsWith(prefix)) continue
      delete envelope.secrets[ref]
      deleted += 1
    }
    if (deleted > 0) {
      await this.persist(envelope)
    }
    return deleted
  }

  private async load(): Promise<SecretEnvelope> {
    if (this.cache) return this.cache
    try {
      const raw = await readFile(this.filePath, `utf8`)
      const parsed = JSON.parse(raw) as Partial<SecretEnvelope>
      this.cache = {
        version: 1,
        secrets:
          parsed.secrets && typeof parsed.secrets === `object`
            ? Object.fromEntries(
                Object.entries(parsed.secrets).filter(
                  (entry): entry is [string, string] =>
                    typeof entry[0] === `string` && typeof entry[1] === `string`
                )
              )
            : {},
      }
    } catch {
      this.cache = cloneEmpty()
    }
    return this.cache
  }

  private async persist(envelope: SecretEnvelope): Promise<void> {
    this.cache = envelope
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(envelope, null, 2))
  }
}
