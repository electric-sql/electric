import * as SQLite from 'expo-sqlite'

import { electrify } from '../../src/drivers/expo-sqlite'
import { dbSchema } from '../client/generated'

const config = {
  auth: {
    token: 'test-token',
  },
}

const original = SQLite.openDatabase('example.db')

const { db } = await electrify(original, dbSchema, config)
await db.Items.findMany({
  select: {
    value: true,
  },
})
