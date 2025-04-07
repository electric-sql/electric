import { worker } from '@electric-sql/pglite/worker'
import { PGlite } from '@electric-sql/pglite'
import { migrate } from './migrations'

worker({
  async init() {
    
    let dataDirName = new URL(location.href).searchParams.get('dataDirName') ?? 'linearlite2'
    console.log('using dataDir', dataDirName)

    const pg = await PGlite.create({
      dataDir: `idb://${dataDirName}`,
      relaxedDurability: true,
    })
    await pg.waitReady

    await migrate(pg)
    return pg
  },
})
