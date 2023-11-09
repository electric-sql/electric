import * as SQLite from './expo-sqlite.js'

import { electrify } from '../../src/drivers/expo-sqlite/index.js'
import { schema } from '../client/generated/index.js'

const config = {
  auth: {
    token: 'test-token',
  },
}

const original = SQLite.openDatabase('example.db')

const { db } = await electrify(original, schema, config)
await db.Items.findMany({
  select: {
    value: true,
  },
})
