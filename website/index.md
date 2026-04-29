---
layout: page
title: 'Electric'
titleTemplate: ':title | Agents on sync'
sidebar: false
pageClass: home-page
mdExport:
  mode: parse-html
# TODO(meta-image): the default meta image
# (/img/meta/electric-sync-primitives.jpg, defined in
# .vitepress/config.mts) still shows the legacy four-card grid and
# no longer reflects the agent-platform positioning. Replace with a
# hero-style composition based on the new homepage hero — title +
# product graphic. Two practical approaches:
#   1. CSS-hack a 1200x630 view of `HomeHero` and screenshot/crop it
#      (cleanest path; the hero already has the right composition).
#   2. Re-design as a static JPG in Figma / similar.
# Note: Twitter/X does NOT autoplay GIFs in cards (animated embeds
# fall back to the first frame), so prefer a static JPG that
# captures the hero at a strong moment, then add an `image:`
# frontmatter override here once the asset is in
# /public/img/meta/.
---

<script setup>
import HomePage from './src/components/home/HomePage.vue'
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

<MdExportParseHtml>
  <HomePage />
</MdExportParseHtml>
