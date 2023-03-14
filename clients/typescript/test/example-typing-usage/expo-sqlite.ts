import * as SQLite from 'expo-sqlite'

import { electrify } from '../../src/drivers/expo-sqlite'
import { z } from 'zod'

const config = {
  app: 'app',
  env: 'env',
  migrations: [],
}

const original = SQLite.openDatabase('example.db')

// Schema describing the DB
// can be defined manually, or generated
const dbSchemas = {
  items: z
    .object({
      value: z.string(),
    })
    .strict(),
}

const { db } = await electrify(original, dbSchemas, config)
await db.items.findMany({
  select: {
    value: true,
  },
})
