import * as SQLite from 'expo-sqlite'

import { electrify } from '../../src/drivers/expo-sqlite'

const config = {
  app: '<YOUR APP SLUG>',
  migrations: [],
}

const original = SQLite.openDatabase('example.db')
const db = await electrify(original, config)

// Original usage
original.transaction((tx) => {
  tx.executeSql('select foo from bar', [], (_tx, results) => {
    console.log('query results: ', results)
  })
})

original.exec([{ sql: 'SELECT 1', args: [] }], false, (error, results) => {
  if (error) console.log(error)
  else console.log(results)
})

// Electrified usage
db.transaction((tx) => {
  tx.executeSql('select foo from bar', [], (_tx, results) => {
    console.log('query results: ', results)
  })
})

db.exec([{ sql: 'SELECT 1', args: [] }], false, (error, results) => {
  if (error) console.log(error)
  else console.log(results)
})
