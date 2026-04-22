import { entityStateSchema } from './entity-schema'
import type { ChangeEvent } from '@durable-streams/state'
import type {
  ContextEntry,
  ContextEntryInput,
  EntityStreamDBWithActions,
  ManifestContextEntry,
  WakeSession,
} from './types'

export interface ContextEntriesApi {
  insertContext: (id: string, entry: ContextEntryInput) => void
  removeContext: (id: string) => void
  getContext: (id: string) => ContextEntry | undefined
  listContext: () => Array<ContextEntry>
}

function manifestKeyFor(id: string): string {
  return `context:${id}`
}

function isContextManifest(
  row: unknown
): row is Record<string, unknown> & { kind: `context` } {
  return (
    typeof row === `object` &&
    row !== null &&
    (row as { kind?: unknown }).kind === `context`
  )
}

function toContextEntry(row: Record<string, unknown>): ContextEntry {
  return {
    id: String(row.id),
    name: String(row.name),
    attrs: (row.attrs ?? {}) as ContextEntry[`attrs`],
    content: String(row.content ?? ``),
    insertedAt: Number(row.insertedAt ?? 0),
  }
}

export function createContextEntriesApi(opts: {
  db: EntityStreamDBWithActions
  writeEvent: (event: ChangeEvent) => void
  wakeSession: WakeSession
  now?: () => string
  nextOffset?: () => number
}): ContextEntriesApi {
  const now = opts.now ?? (() => new Date().toISOString())
  const nextOffset = opts.nextOffset ?? (() => Date.now())
  const keySuffixCounts = new Map<number, number>()

  function nextKeySuffix(): { offset: number; suffix: string } {
    const offset = nextOffset()
    const collisionCount = keySuffixCounts.get(offset) ?? 0
    keySuffixCounts.set(offset, collisionCount + 1)

    return {
      offset,
      suffix:
        collisionCount === 0 ? `${offset}` : `${offset}_${collisionCount}`,
    }
  }

  function readLiveEntry(id: string): ContextEntry | undefined {
    const key = manifestKeyFor(id)
    for (const row of opts.db.collections.manifests.toArray) {
      if (!isContextManifest(row)) continue
      if (row.key === key || row.id === id) {
        return toContextEntry(row)
      }
    }
    return undefined
  }

  return {
    insertContext(id, entry) {
      const attrs = entry.attrs ?? {}
      const { offset: insertedAt, suffix } = nextKeySuffix()
      const event = entityStateSchema.contextInserted.insert({
        key: `context:${id}:${suffix}`,
        value: {
          id,
          name: entry.name,
          attrs,
          content: entry.content,
          timestamp: now(),
        } as never,
      }) as ChangeEvent
      opts.writeEvent(event)

      const manifestEntry: ManifestContextEntry = {
        key: manifestKeyFor(id),
        kind: `context`,
        id,
        name: entry.name,
        attrs,
        content: entry.content,
        insertedAt,
      }
      opts.wakeSession.registerManifestEntry(manifestEntry)
    },

    removeContext(id) {
      const live = readLiveEntry(id)
      if (!live) {
        return
      }

      const { suffix } = nextKeySuffix()
      const event = entityStateSchema.contextRemoved.insert({
        key: `context:${id}:removed:${suffix}`,
        value: {
          id,
          name: live.name,
          timestamp: now(),
        } as never,
      }) as ChangeEvent
      opts.writeEvent(event)
      opts.wakeSession.removeManifestEntry(manifestKeyFor(id))
    },

    getContext(id) {
      return readLiveEntry(id)
    },

    listContext() {
      const entries: Array<ContextEntry> = []
      for (const row of opts.db.collections.manifests.toArray) {
        if (isContextManifest(row)) {
          entries.push(toContextEntry(row))
        }
      }
      return entries.sort((left, right) => left.insertedAt - right.insertedAt)
    },
  }
}
