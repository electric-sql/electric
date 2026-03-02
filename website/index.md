---
layout: home
title: "Electric"
titleTemplate: ":title | Data platform for multi-agent"
hero:
  name: 'The data platform'
  text: '<br />for multi-agent'
  tagline: >-
    Electric provides the data primitives and&nbsp;infra to build collaborative,
    <span class="no-wrap">multi-agent systems</span>
  actions:
    - theme: brand
      text: Start building now »
      link: https://dashboard.electric-sql.cloud/
  image:
    src: /img/home/zap-with-halo.svg
---

<script setup>
import { onMounted } from 'vue'

import {
  BackedBySection,
  DeploymentSection,
  GetStartedStrap,
  LatestNewsSection,
  NoSilosStrap,
  OpenSourceSection,
  ProductsSection,
  ScalesToSection,
  SolutionsSection,
  WorksWithSection
} from './src/components/home'

onMounted(() => {
  if (typeof window !== 'undefined' && document.querySelector) {
    document.querySelectorAll('.actions a[href^="https://github.com"]').forEach((link) => {
      if (!link.querySelector('.vpi-social-github')) {
        const icon = document.createElement('span')
        icon.classList.add('vpi-social-github')

        link.prepend(icon)
      }
    })
  }
})
</script>

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

<SolutionsSection />
<ProductsSection />
<WorksWithSection />
<DeploymentSection />
<ScalesToSection />
<NoSilosStrap />
<LatestNewsSection />
<GetStartedStrap />
<BackedBySection />
<OpenSourceSection />
