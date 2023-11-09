import { electrify } from '../../src/drivers/cordova-sqlite-storage/index.js'
import { schema } from '../client/generated/index.js'

const config = {
  auth: {
    token: 'test-token',
  },
}

const opts = {
  name: 'example.db',
  location: 'default',
}

document.addEventListener('deviceready', () => {
  window.sqlitePlugin.openDatabase(opts, async (original) => {
    const { db } = await electrify(original, schema, config)
    await db.Items.findMany({
      select: {
        value: true,
      },
    })
  })
})
