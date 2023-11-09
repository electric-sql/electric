import Database from './better-sqlite3.js'

import { electrify } from '../../src/drivers/better-sqlite3/index.js'
import { schema } from '../client/generated/index.js'

const config = {
  auth: {
    token: 'test-token',
  },
}

const original = new Database('example.db')

// Electrify the DB and use the DAL to query the `Items` table
const { db } = await electrify(original, schema, config)
await db.Items.findMany({
  select: {
    value: true,
  },
})
