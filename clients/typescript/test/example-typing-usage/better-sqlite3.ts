import Database from 'better-sqlite3'

import { electrify } from '../../src/drivers/better-sqlite3'
import { z } from 'zod'

const config = {
  app: 'app',
  env: 'env',
  migrations: [],
}

const original = new Database('example.db')

// Schema describing the DB
// can be defined manually, or generated
const dbSchemas = {
  items: z
    .object({
      value: z.string(),
    })
    .strict(),
}

// Electrify the DB and use the DAL to query the `items` table
const ns = await electrify(original, dbSchemas, config)
await ns.dal.items.findMany({
  select: {
    value: true,
  },
})
