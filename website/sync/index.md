---
layout: page
title: Electric Sync
titleTemplate: false
description: A read-path sync engine for fast, collaborative apps and live agents — built on shapes, fanned out over CDN, written through your existing backend.
sidebar: false
pageClass: sync-page
---

<div data-template="true" class="hidden" id="works-with-sql-template">

```sql
INSERT INTO todos VALUES ('sync');
```

</div>
<div data-template="true" class="hidden" id="works-with-tsx-template">

```tsx
const Todos = () => {
  const { data } = useLiveQuery(query =>
    query
      .from({ todo: todoCollection })
      .where(({ todo }) => todo.completed)
  )

  return <List todos={data} />
}
```

</div>

<SyncHomePage />
