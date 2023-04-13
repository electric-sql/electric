import * as SQLite from 'expo-sqlite'

import { electrify } from '../../src/drivers/expo-sqlite'
import { dbDescription } from '../client/generated'

const config = {
  app: 'app',
  env: 'env',
  migrations: [],
}

const original = SQLite.openDatabase('example.db')

const { db } = await electrify(original, dbDescription, config)
await db.Items.findMany({
  select: {
    value: true,
  },
})
