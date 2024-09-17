import { PGlite } from '@electric-sql/pglite'
import { live } from '@electric-sql/pglite/live'
import { electricSync } from '@electric-sql/pglite-sync'
import { useLiveQuery } from '@electric-sql/pglite-react'

// Create a persistent local PGlite database
const pg = await PGlite.create({
  dataDir: 'idb://my-database',
  extensions: {,
    electric: electricSync(),
    live
  }
})

// Setup the local database schema
await pg.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id SERIAL PRIMARY KEY,
  );
`)

// Establish a persistent shape subscription
await pg.electric.syncShapeToTable({
  url: `${BASE_URL}/v1/shape/items`,
  table: 'items',
  primaryKey: ['id'],
})

// Bind data to your components using live queries
// against the local embedded database
const Component = () => {
  const items = useLiveQuery(
    `SELECT * FROM items;`
  )

  return (
    <pre>{ JSON.stringify(items) }<pre>
  )
}