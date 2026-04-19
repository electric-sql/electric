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
<a href="/docs/sync/api/http">
HTTP API</a>,
<span class="no-wrap-sm">
<a href="/docs/sync/api/clients/typescript">
client&nbsp;libraries</a>
and
<a href="/docs/sync/integrations/react">
framework&nbsp;hooks</a></span>.
</span>

```tsx
import { useShape } from '@electric-sql/react'

const Component = () => {
  const { data } = useShape({
    url: `${BASE_URL}/v1/shape`,
    params: {
      table: `items`
    }
  })

  return (
    <pre>{ JSON.stringify(data) }<pre>
  )
}
```

<div class="actions cta-actions">
  <div class="action">
    <VPButton
        href="/docs/sync/quickstart"
        text="Quickstart"
        theme="brand"
    />
  </div>
  <div class="action">
    <VPButton href="/docs/sync/api/http"
        text="API docs"
        theme="alt"
    />
  </div>
  <div class="action hidden-sm">
    <VPButton href="/sync/demos"
        target="_blank"
        text="Demos"
        theme="alt"
    />
  </div>
</div>

And you can level-up
<span class="hidden-sm">
all the way</span>
to syncing into a local embedded
<span class="no-wrap">
[PGlite database](/sync/pglite)</span>.
<span class="no-wrap-md hidden-sm">
With
<span class="no-wrap">
built-in [persistence](https://pglite.dev/docs/filesystems)</span>
and
<span class="no-wrap">
[live reactivity](https://pglite.dev/docs/live-queries)</span>.</span>

<<< @/src/partials/sync-into-pglite.tsx

<div class="actions cta-actions">
  <div class="action">
    <VPButton
        href="/docs/sync"
        text="Learn more"
        theme="brand"
    />
  </div>
  <div class="action">
    <VPButton href="https://github.com/electric-sql/electric"
        target="_blank"
        text="Star on GitHub"
        theme="alt"
    />
  </div>
</div>
