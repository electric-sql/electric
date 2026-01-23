---
layout: home
title: "Electric"
titleTemplate: ":title | Sync with your stack"
hero:
  name: 'Sync'
  text: '<br />with your stack'
  tagline: >-
    Build fast, modern, collaborative apps without&nbsp;changing&nbsp;your&nbsp;stack.
  actions:
    - theme: brand
      text: Sign-up to Cloud
      link: https://dashboard.electric-sql.cloud/
    - theme: brand
      text: Sign-up
      link: https://dashboard.electric-sql.cloud/
    - theme: alt
      text: Quickstart
      link: /docs/quickstart
    - theme: alt
      text: '​'
      target: '_blank'
      link: https://github.com/electric-sql/electric
    - theme: alt
      text: GitHub
      target: '_blank'
      link: https://github.com/electric-sql/electric
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
  UsedBySection,
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
<UsedBySection />
<BackedBySection />
<OpenSourceSection />
<LatestNewsSection />
<GetStartedStrap />
