import { electrify } from '../../src/drivers/cordova-sqlite-storage'
import { schema } from '../client/generated'

const opts = {
  name: 'example.db',
  location: 'default',
}

document.addEventListener('deviceready', () => {
  window.sqlitePlugin.openDatabase(opts, async (original) => {
    const { db } = await electrify(original, schema)
    await db.Items.findMany({
      select: {
        value: true,
      },
    })
  })
})
