import {
  createCollection,
  localOnlyCollectionOptions,
} from '@durable-streams/state'

let nextCollectionId = 0

export interface LocalOnlyTestCollection<TRow extends object> {
  cleanup: () => Promise<void>
  delete: (key: string) => unknown
  get: (key: string) => TRow | undefined
  has: (key: string) => boolean
  id: string
  insert: (value: TRow) => unknown
  preload: () => Promise<void>
  toArray: Array<TRow>
  update: (key: string, updater: (draft: TRow) => void) => unknown
  utils: {
    acceptMutations: (transaction: {
      mutations: Array<{ collection: { id: string } }>
    }) => void
  }
  values: () => IterableIterator<TRow>
}

function cloneRows<TRow extends object>(rows: Array<TRow>): Array<TRow> {
  return rows.map((row) => ({ ...row }))
}

function stripVirtualFields<TRow extends object>(
  row: TRow | undefined
): TRow | undefined {
  if (!row) {
    return undefined
  }

  const clone = {
    ...(row as Record<string, unknown>),
  } as Record<string, unknown>
  delete clone.$collectionId
  delete clone.$key
  delete clone.$origin
  delete clone.$synced
  return clone as TRow
}

function defaultKeyResolver(row: Record<string, unknown>): string {
  const key = row.key
  if (typeof key === `string` || typeof key === `number`) {
    return String(key)
  }
  throw new Error(`Local-only test collection rows must include a string key`)
}

export function createLocalOnlyTestCollection<TRow extends object>(
  rows: Array<TRow>,
  opts?: {
    getKey?: (row: TRow) => string
    id?: string
  }
): LocalOnlyTestCollection<TRow> {
  const collection = createCollection(
    localOnlyCollectionOptions({
      id: opts?.id ?? `test-local-${nextCollectionId++}`,
      getKey:
        opts?.getKey ??
        ((row: TRow) => defaultKeyResolver(row as Record<string, unknown>)),
      initialData: [],
    })
  ) as unknown as LocalOnlyTestCollection<TRow>

  for (const row of cloneRows(rows)) {
    collection.insert(row)
  }

  const rawGet = collection.get.bind(collection)
  Object.defineProperty(collection, `get`, {
    value: (key: string) => stripVirtualFields(rawGet(key)),
  })

  Object.defineProperty(collection, `toArray`, {
    get() {
      const current = Array.from(collection.values())
      return current
        .map((row) => stripVirtualFields(row))
        .filter(Boolean) as Array<TRow>
    },
  })

  return collection
}
