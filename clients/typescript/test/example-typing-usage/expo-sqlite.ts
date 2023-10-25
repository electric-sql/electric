import * as SQLite from 'expo-sqlite'

import { Database, electrify } from '../../src/drivers/expo-sqlite'
import { schema } from '../client/generated'

const config = {
  auth: {
    token: 'test-token',
  },
}

const original = new Database(SQLite.openDatabase('example.db'))

const { db } = await electrify(original, schema, config)
await db.Items.findMany({
  select: {
    value: true,
  },
})
