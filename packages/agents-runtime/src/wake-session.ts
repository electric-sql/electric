import { createTransaction, deepEquals } from '@durable-streams/state'
import { entityStateSchema } from './entity-schema'
import type { ChangeEvent } from '@durable-streams/state'
import type {
  EntityStreamDBWithActions,
  ManifestEntry,
  PendingSend,
  SetupCompleteResult,
  SharedStateHandleInfo,
  SourceHandleInfo,
  SpawnHandleInfo,
  WakePhase,
  WakeSession,
} from './types'

type WakeSessionDb = {
  utils: Pick<EntityStreamDBWithActions[`utils`], `awaitTxId`>
  collections: Pick<EntityStreamDBWithActions[`collections`], `manifests`>
}

type ManifestTransaction = ReturnType<
  typeof createTransaction<Record<string, unknown>>
>

export type WakeSessionOptions =
  | {
      writeEvent: (event: ChangeEvent) => void
      flushWrites: () => Promise<void>
    }
  | { writeEvent?: undefined; flushWrites?: undefined }

const MANIFEST_TXID_TIMEOUT_MS = 20_000

export function createWakeSession(
  db: WakeSessionDb,
  options: WakeSessionOptions = {}
): WakeSession {
  return new BasicWakeSession(db, loadExistingManifestEntries(db), options)
}

class BasicWakeSession implements WakeSession {
  private phase: WakePhase = `setup`
  private readonly db: WakeSessionDb
  private readonly persistedManifest: Map<string, ManifestEntry>
  private readonly manifest = new Map<string, ManifestEntry>()
  private manifestTransaction: ManifestTransaction
  private readonly pendingSends: Array<PendingSend> = []
  private readonly sharedStateHandles = new Map<string, SharedStateHandleInfo>()
  private readonly spawnHandles = new Map<string, SpawnHandleInfo>()
  private readonly sourceHandles = new Map<string, SourceHandleInfo>()
  private readonly options: WakeSessionOptions

  constructor(
    db: WakeSessionDb,
    persistedManifest: Map<string, ManifestEntry>,
    options: WakeSessionOptions = {}
  ) {
    this.db = db
    this.persistedManifest = persistedManifest
    this.options = options
    this.manifestTransaction = this.createManifestTransaction()
  }

  getPhase(): WakePhase {
    return this.phase
  }

  registerManifestEntry(entry: ManifestEntry): boolean {
    this.assertSetupOrActive(`manifest`)
    const previous =
      this.manifest.get(entry.key) ?? this.persistedManifest.get(entry.key)
    if (previous && deepEquals(previous, entry)) {
      return false
    }

    this.manifest.set(entry.key, entry)
    this.stageManifestEntry(entry)
    return true
  }

  removeManifestEntry(key: string): boolean {
    this.assertSetupOrActive(`manifest`)
    const existed = this.manifest.has(key) || this.persistedManifest.has(key)
    if (!existed) {
      return false
    }

    this.manifest.delete(key)
    this.stageManifestDelete(key)
    return true
  }

  async commitManifestEntries(): Promise<void> {
    if (this.manifestTransaction.mutations.length === 0) {
      return
    }

    const transaction = this.manifestTransaction
    await transaction.commit()

    for (const mutation of transaction.mutations) {
      if (mutation.type === `delete`) {
        this.persistedManifest.delete(mutation.key)
        continue
      }

      if (!isManifestEntry(mutation.modified)) {
        continue
      }

      this.persistedManifest.set(
        mutation.key,
        normalizeManifestEntry(mutation.modified)
      )
    }

    this.manifestTransaction = this.createManifestTransaction()
  }

  rollbackManifestEntries(): void {
    if (
      this.manifestTransaction.state === `pending` &&
      this.manifestTransaction.mutations.length > 0
    ) {
      this.manifestTransaction.rollback()
    }
    this.manifestTransaction = this.createManifestTransaction()
  }

  registerSharedStateHandle(id: string, handle: SharedStateHandleInfo): void {
    this.assertSetupOrActive(`sharedState`)
    this.sharedStateHandles.set(id, handle)
  }

  registerSpawnHandle(id: string, handle: SpawnHandleInfo): void {
    this.assertSetupOrActive(`spawn`)
    this.spawnHandles.set(id, handle)
  }

  registerSourceHandle(id: string, handle: SourceHandleInfo): void {
    this.assertSetupOrActive(`observe`)
    this.sourceHandles.set(id, handle)
  }

  enqueueSend(send: PendingSend): void {
    if (this.phase === `closing` || this.phase === `closed`) {
      throw new Error(
        `[agent-runtime] send cannot be called after the wake is closing`
      )
    }
    this.pendingSends.push(send)
  }

  getManifest(): Array<ManifestEntry> {
    return [...this.manifest.values()]
  }

  getPendingSends(): Array<PendingSend> {
    return [...this.pendingSends]
  }

  getSharedStateHandles(): Map<string, SharedStateHandleInfo> {
    return new Map(this.sharedStateHandles)
  }

  getSpawnHandles(): Map<string, SpawnHandleInfo> {
    return new Map(this.spawnHandles)
  }

  getSourceHandles(): Map<string, SourceHandleInfo> {
    return new Map(this.sourceHandles)
  }

  finishSetup(): SetupCompleteResult {
    this.assertSetupOnly(`finishSetup`)
    this.phase = `active`
    return {
      manifest: this.getManifest(),
      sharedStateHandles: this.getSharedStateHandles(),
      spawnHandles: this.getSpawnHandles(),
      sourceHandles: this.getSourceHandles(),
    }
  }

  close(): Promise<void> {
    if (this.phase === `closed`) return Promise.resolve()
    this.phase = `closing`
    if (
      this.manifestTransaction.state === `pending` &&
      this.manifestTransaction.mutations.length > 0
    ) {
      this.manifestTransaction.rollback()
    }
    this.phase = `closed`
    return Promise.resolve()
  }

  private stageManifestEntry(entry: ManifestEntry): void {
    const manifests = this.db.collections.manifests
    const nextEntry = cloneManifestEntry(entry)
    const existing = manifests.get(entry.key) as ManifestEntry | undefined

    const applyDraft = (draft: object): void => {
      const record = draft as Record<string, unknown>
      for (const key of Object.keys(record)) {
        delete record[key]
      }
      Object.assign(record, nextEntry)
    }

    this.manifestTransaction.mutate(() => {
      if (!existing) {
        manifests.insert(nextEntry)
        return
      }

      manifests.update(entry.key, applyDraft)
    })
  }

  private stageManifestDelete(key: string): void {
    const manifests = this.db.collections.manifests as {
      has: (manifestKey: string) => boolean
      delete: (manifestKey: string) => void
    }

    this.manifestTransaction.mutate(() => {
      if (manifests.has(key)) {
        manifests.delete(key)
      }
    })
  }

  private createManifestTransaction(): ManifestTransaction {
    const { writeEvent, flushWrites } = this.options
    return createTransaction<Record<string, unknown>>({
      autoCommit: false,
      mutationFn: async ({ transaction }) => {
        if (!writeEvent) {
          this.db.collections.manifests.utils.acceptMutations(transaction)
          return
        }

        const txid = crypto.randomUUID()
        for (const mutation of transaction.mutations) {
          if (mutation.type === `delete`) {
            writeEvent(
              entityStateSchema.manifests.delete({
                key: mutation.key,
                headers: { txid },
              }) as ChangeEvent
            )
            continue
          }

          const entry = this.manifest.get(mutation.key)
          if (!entry) {
            throw new Error(
              `[agent-runtime] manifest mutation for key "${mutation.key}" has no in-memory entry`
            )
          }

          const helper =
            mutation.type === `insert`
              ? entityStateSchema.manifests.insert
              : entityStateSchema.manifests.update
          writeEvent(
            helper({
              value: entry as never,
              headers: { txid },
            }) as ChangeEvent
          )
        }

        await flushWrites()
        await this.db.utils.awaitTxId(txid, MANIFEST_TXID_TIMEOUT_MS)
      },
    })
  }

  private assertSetupOnly(apiName: string): void {
    if (this.phase !== `setup`) {
      throw new Error(
        `[agent-runtime] ${apiName} can only be called during setup()`
      )
    }
  }

  private assertSetupOrActive(apiName: string): void {
    if (this.phase !== `setup` && this.phase !== `active`) {
      throw new Error(
        `[agent-runtime] ${apiName} cannot be called after the wake is closing`
      )
    }
  }
}

function cloneManifestEntry(entry: ManifestEntry): ManifestEntry {
  return structuredClone(entry)
}

function normalizeManifestEntry(entry: ManifestEntry): ManifestEntry {
  const clone = cloneManifestEntry(entry) as ManifestEntry & {
    _offset?: unknown
    _seq?: unknown
    $collectionId?: unknown
    $key?: unknown
    $origin?: unknown
    $synced?: unknown
  }
  delete clone._offset
  delete clone._seq
  delete clone.$collectionId
  delete clone.$key
  delete clone.$origin
  delete clone.$synced
  return clone
}

function isManifestEntry(value: unknown): value is ManifestEntry {
  return (
    typeof value === `object` &&
    value !== null &&
    typeof (value as { key?: unknown }).key === `string` &&
    typeof (value as { kind?: unknown }).kind === `string`
  )
}

function loadExistingManifestEntries(
  db: WakeSessionDb
): Map<string, ManifestEntry> {
  const existing = new Map<string, ManifestEntry>()
  const manifests = db.collections.manifests

  for (const manifest of manifests.toArray) {
    if (!isManifestEntry(manifest)) continue
    const normalizedManifest = normalizeManifestEntry(manifest)
    existing.set(normalizedManifest.key, normalizedManifest)
  }

  return existing
}
