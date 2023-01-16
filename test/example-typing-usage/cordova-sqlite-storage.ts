import { electrify } from '../../src/drivers/cordova-sqlite-storage'

const config = {
  app: '<YOUR APP SLUG>',
  migrations: [],
}

const opts = {
  name: 'example.db',
  location: 'default',
}

document.addEventListener('deviceready', () => {
  window.sqlitePlugin.openDatabase(opts, async (original) => {
    const db = await electrify(original, config)

    // Use as normal, e.g.:
    db.executeSql('select foo from bar', [], (results) => {
      console.log('query results: ', results)
    })
  })
})
