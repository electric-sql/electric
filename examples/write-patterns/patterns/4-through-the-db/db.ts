import { PGlite } from '@electric-sql/pglite'
import { type PGliteWithLive, live } from '@electric-sql/pglite/live'
import { electricSync } from '@electric-sql/pglite-sync'

import localSchemaMigrations from './local-schema.sql?raw'

const DATA_DIR = 'idb://electric-write-patterns-example'
const ELECTRIC_URL = import.meta.env.ELECTRIC_URL || 'http://localhost:3000'

const registry = new Map<string, Promise<PGliteWithLive>>()

export default async function loadPGlite(): Promise<PGliteWithLive> {
  const loadingPromise = registry.get('loadingPromise')

  if (loadingPromise === undefined) {
    registry.set('loadingPromise', _loadPGlite())
  }

  return loadingPromise as Promise<PGliteWithLive>
}

async function _loadPGlite(): Promise<PGliteWithLive> {
  const pglite: PGliteWithLive = await PGlite.create(DATA_DIR, {
    extensions: {
      electric: electricSync(),
      live,
    },
  })

  await pglite.exec(localSchemaMigrations)

  await pglite.electric.syncShapeToTable({
    shape: {
      url: `${ELECTRIC_URL}/v1/shape`,
      table: 'todos',
    },
    shapeKey: 'todos',
    table: 'todos_synced',
    primaryKey: ['id'],
  })

  return pglite
}
