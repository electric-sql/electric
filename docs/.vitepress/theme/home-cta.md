## Get started now

You can adopt Electric incrementally right now,
<span class="no-wrap">
  one data fetch</span>
<span class="no-wrap">
  at a time</span>.
<span class="hidden-sm">
  <br class="hidden-md" />
  Using
  our
  <a href="/api/http">
    HTTP API</a>,
  <span class="no-wrap-sm">
    <a href="/api/clients/typescript">
      client&nbsp;libraries</a>
    and
    <a href="/api/integrations/react">
      framework&nbsp;hooks</a></span>.
</span>

```tsx
import { useShape } from '@electric-sql/react'

const Component = () => {
  const { data } = useShape({
    url: `/v1/shape/items`
  })

  return (
    <pre>{ data }<pre>
  )
}
```

<div class="actions">
  <div class="action">
    <VPButton
        href="/guides/quickstart"
        text="Quickstart"
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