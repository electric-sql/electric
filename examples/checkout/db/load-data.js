import dotenvFlow from 'dotenv-flow'
dotenvFlow.config()

import createPool, { sql } from '@databases/pg'
import fs from 'fs'
import path from 'path'
import * as url from 'url'

const dirname = url.fileURLToPath(new URL('.', import.meta.url))
const DATA_DIR = process.env.DATA_DIR || path.resolve(dirname, 'data')

console.info(`Connecting to Postgres..`)
const db = createPool(process.env.DATABASE_URL)

const items = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'items.json'), 'utf8')
)

await db.tx(async (db) => {
  // Delete all existing data
  await db.query(sql`
    DELETE FROM items;
  `)

  // Insert all the data
  await db.query(sql`
    INSERT INTO items (id, slug, name, price, description)
    VALUES ${sql.join(
      items.map(
        (item) =>
          sql`(${item.id}, ${item.slug}, ${item.name}, ${item.price}, ${item.description})`
      ),
      ','
    )}
  `)
})
