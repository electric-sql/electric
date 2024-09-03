## Get started now

You can start by adopting Electric incrementally,
<span class="no-wrap">
  one data fetch</span>
<span class="no-wrap">
  at a time</span>.
<span class="hidden-sm">
  <br class="hidden-md" />
  Using
  our
  <a href="/docs/api/http">
    HTTP API</a>,
  <span class="no-wrap-sm">
    <a href="/docs/api/clients/typescript">
      client&nbsp;libraries</a>
    and
    <a href="/docs/api/integrations/react">
      framework&nbsp;hooks</a></span>.
</span>

```tsx
import { useShape } from '@electric-sql/react'

const Component = () => {
  const { data } = useShape({
    url: `${BASE_URL}/v1/shape/items`
  })

  return (
    <pre>{ JSON.stringify(data) }<pre>
  )
}
```

<div class="actions cta-actions">
  <div class="action">
    <VPButton
        href="/docs/quickstart"
        text="Quickstart"
        theme="brand"
    />
  </div>
  <div class="action">
    <VPButton href="/docs/api/http"
        text="API docs"
        theme="alt"
    />
  </div>
  <div class="action hidden-sm">
    <VPButton href="https://github.com/electric-sql/electric/tree/main/examples"
        target="_blank"
        text="Examples"
        theme="alt"
    />
  </div>
</div>

And you can level-up
<span class="hidden-sm">
  all the way</span>
to syncing into a local embedded
<span class="no-wrap">
  [PGlite database](/product/pglite)</span>.
<span class="no-wrap-md hidden-sm">
  With
  <span class="no-wrap">
    built-in [persistence](https://pglite.dev/docs/filesystems)</span>
  and
  <span class="no-wrap">
    [live reactivity](https://pglite.dev/docs/live-queries)</span>.</span>

```tsx
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
```

<div class="actions cta-actions">
  <div class="action">
    <VPButton
        href="/docs/intro"
        text="Learn more"
        theme="brand"
    />
  </div>
  <div class="action">
    <VPButton href="https://github.com/electric-sql"
        target="_blank"
        text="Star on GitHub"
        theme="alt"
    />
  </div>
</div>