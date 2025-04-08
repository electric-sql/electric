import { worker } from '@electric-sql/pglite/worker'
import { PGlite } from '@electric-sql/pglite'
import { migrate } from './migrations'

import { PGlite as PGlite03 } from 'pglite-03'

worker({
  async init() {
    const usePGliteNext =
      new URL(location.href).searchParams.has('usePGnext') ?? false

    const dataDirName =
      new URL(location.href).searchParams.get('dataDirName') ?? 'linearlite2'
    console.log('using dataDir', dataDirName)

    let pg
    if (usePGliteNext) {
      const pg03 = await PGlite03.create({
        dataDir: `idb://${dataDirName}`,
        relaxedDurability: true,
      })
      pg = pg03 as unknown as PGlite
    } else {
      pg = await PGlite.create({
        dataDir: `idb://${dataDirName}`,
        relaxedDurability: true,
      })
    }

    await pg.waitReady

    await migrate(pg)

    const version = await pg.exec('SELECT version();')
    console.log('PostgreSQL version', version)

    return pg
  },
})
