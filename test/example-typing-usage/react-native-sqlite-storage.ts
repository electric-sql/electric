import SQLite from 'react-native-sqlite-storage'
import {
  electrify,
  Database,
} from '../../src/drivers/react-native-sqlite-storage'

// You can use the driver with or without the promise API enabled.
// Either way, you need to pass in a flag to the `electrify` function
// below to indicate whether promises are enabled or not.
const promisesEnabled = true
SQLite.enablePromise(promisesEnabled)

const config = {
  app: 'app',
  env: 'env',
  migrations: [],
}

const original = await SQLite.openDatabase({ name: 'example.db' })
// FIXME: casting here is required due to a typo and missing properties on the 'react-native-sqlite-storage'.
//        It can be removed after the types are updated via https://github.com/DefinitelyTyped/DefinitelyTyped/pull/63909
const db = await electrify(
  original as unknown as Database,
  promisesEnabled,
  config
)
// Use as normal, e.g.:
original.transaction((tx) => {
  tx.executeSql('SELECT 1', [], (_tx, results) => {
    console.log('query results: ', results)
  })
})

// Use as normal, e.g.:
db.transaction((tx) => {
  tx.executeSql('SELECT 1', [], (_tx, results) => {
    console.log('query results: ', results)
  })
})
