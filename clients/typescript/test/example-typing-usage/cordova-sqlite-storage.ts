import { electrify } from '../../src/drivers/cordova-sqlite-storage'
import { dbDescription } from '../client/generated'

const config = {
  app: 'app',
  env: 'env',
  migrations: [],
}

const opts = {
  name: 'example.db',
  location: 'default',
}

document.addEventListener('deviceready', () => {
  window.sqlitePlugin.openDatabase(opts, async (original) => {
    const { db } = await electrify(original, dbDescription, config)
    await db.items.findMany({
      select: {
        value: true,
      },
    })
  })
})
