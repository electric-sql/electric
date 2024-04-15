import Database from 'better-sqlite3'

import { electrify } from '../../src/drivers/better-sqlite3'
import { schema } from '../client/generated'

const original = new Database('example.db')

// Electrify the DB and use the DAL to query the `Items` table
const { db } = await electrify(original, schema)
await db.Items.findMany({
  select: {
    value: true,
  },
})
