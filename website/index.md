---
layout: page
title: 'Electric'
titleTemplate: ':title | The data platform for multi-agent'
sidebar: false
pageClass: home-page
---

<div data-template="true" class="hidden" id="works-with-sql-template">

```sql
INSERT INTO todos VALUES ('sync');
```

</div>
<div data-template="true" class="hidden" id="works-with-sse-template">

```json
data: {"type": "text-delta", "delta": "Hi, "}
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

<HomePage />
