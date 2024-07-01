import * as SQLite from 'expo-sqlite'

import { electrify } from '../../src/drivers/expo-sqlite'
import { schema } from '../client/generated'

const original = SQLite.openDatabase('example.db')

const { db } = await electrify(original, schema)
await db.Items.findMany({
  select: {
    value: true,
  },
})
