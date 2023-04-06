import { initElectricSqlJs } from '../../src/drivers/absurd-sql'
import { dbDescription } from '../client/generated'

const config = {
  app: 'app',
  env: 'env',
  migrations: [],
}

// Start the background worker.
const url = new URL('./worker.js', import.meta.url)
const worker = new Worker(url, { type: 'module' })

// Electrify the SQL.js / absurd-sql machinery and then open
// a persistent, named database.
const SQL = await initElectricSqlJs(worker, {
  locateFile: (file) => `/${file}`,
})
const { db, adapter } = await SQL.openDatabase(
  'example.db',
  dbDescription,
  config
)

await adapter.run({ sql: 'DROP TABLE IF EXISTS items' })
await adapter.run({
  sql: 'CREATE TABLE IF NOT EXISTS items (value TEXT PRIMARY KEY NOT NULL) WITHOUT ROWID;',
})
await db.items.createMany({
  data: [
    {
      value: 'foo',
    },
    {
      value: 'bar',
    },
  ],
})

const items = await db.items.findMany({})
console.log('results: ', items)
