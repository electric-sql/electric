import SQLite from 'react-native-sqlite-storage'
import { electrify } from '../../src/drivers/react-native-sqlite-storage'
import { dbSchema } from '../client/generated'

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
const { db } = await electrify(original, dbSchema, promisesEnabled, config)

await db.Items.findMany({
  select: {
    value: true,
  },
})
