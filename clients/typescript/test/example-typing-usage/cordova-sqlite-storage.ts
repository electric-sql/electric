import { electrify } from '../../src/drivers/cordova-sqlite-storage'
import { z } from 'zod'

const config = {
  app: 'app',
  env: 'env',
  migrations: [],
}

const opts = {
  name: 'example.db',
  location: 'default',
}

// Schema describing the DB
// can be defined manually, or generated
const dbSchemas = {
  items: z
    .object({
      value: z.string(),
    })
    .strict(),
}

document.addEventListener('deviceready', () => {
  window.sqlitePlugin.openDatabase(opts, async (original) => {
    const { db } = await electrify(original, dbSchemas, config)
    await db.items.findMany({
      select: {
        value: true,
      },
    })
  })
})
