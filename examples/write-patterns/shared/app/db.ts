import { PGlite } from '@electric-sql/pglite'
import { PGliteWithLive, live } from '@electric-sql/pglite/live'
import { electricSync } from '@electric-sql/pglite-sync'

const pglite: PGliteWithLive = await PGlite.create(
  'idb://electric-write-patterns', {
    extensions: {
      electric: electricSync(),
      live
    }
  }
)

export default pglite