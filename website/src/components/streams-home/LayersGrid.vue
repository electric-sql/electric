<script setup lang="ts">
import MarkdownContent from "../MarkdownContent.vue"
import MdExportExplicit from "../MdExportExplicit.vue"
import { useMarkdownExport } from "../../lib/useMarkdownExport"

interface Layer {
  tag: string
  title: string
  body: string
  code: string[]
  href: string
  linkLabel: string
}

const layers: Layer[] = [
  {
    tag: "01 · the wire",
    title: "Electric Streams",
    body: "Append bytes, replay from any offset. The HTTP base protocol every other layer is built on.",
    code: [
      "PUT   /v1/stream/x",
      "POST  /v1/stream/x",
      "GET   /v1/stream/x?offset=…",
    ],
    href: "/docs/streams/",
    linkLabel: "Concepts →",
  },
  {
    tag: "02 · messages",
    title: "JSON mode",
    body: "Append JSON values, GET arrays. Message boundaries are preserved on the wire — no framing logic in your code.",
    code: [
      `Content-Type: application/json`,
      `POST  → {"hello":"world"}`,
      `GET   → [ {…}, {…}, {…} ]`,
    ],
    href: "/docs/streams/json-mode",
    linkLabel: "JSON mode →",
  },
  {
    tag: "03 · typed CRUD",
    title: "Durable State",
    body: "Typed insert / update / delete events on the wire, plus snapshot markers. Materialise them into a live key-value view.",
    code: [
      `{"type":"user","value":{…},"headers":{"operation":"insert"}}`,
      `{"type":"user","key":"1","headers":{"operation":"delete"}}`,
      `{"headers":{"control":"snapshot-end"}}`,
    ],
    href: "/docs/streams/durable-state",
    linkLabel: "Durable State →",
  },
  {
    tag: "04 · reactive DB",
    title: "StreamDB",
    body: "Live, typed collections with queries and optimistic actions, layered on top of MaterializedState.",
    code: [
      `db.users.where({ … })`,
      `db.users.insert(row)`,
      `useLiveQuery(query)`,
    ],
    href: "/docs/streams/stream-db",
    linkLabel: "StreamDB →",
  },
]

const markdownLayers = layers
  .map(
    (layer, index) => `### ${index + 1}. ${layer.title}

${layer.body}

\`\`\`
${layer.code.join("\n")}
\`\`\`

[${layer.linkLabel}](${layer.href})`
  )
  .join("\n\n")

const isMarkdownExport = useMarkdownExport()
</script>

<template>
  <MdExportExplicit v-if="isMarkdownExport">
    <MarkdownContent>{{ markdownLayers }}</MarkdownContent>
  </MdExportExplicit>
  <div v-else class="lg">
    <a
      v-for="layer in layers"
      :key="layer.title"
      :href="layer.href"
      class="lg-card"
    >
      <div class="lg-tag">{{ layer.tag }}</div>
      <h3 class="lg-title">{{ layer.title }}</h3>
      <p class="lg-body">{{ layer.body }}</p>
      <div class="lg-code">
        <div v-for="(line, i) in layer.code" :key="i" class="lg-code-line">{{ line }}</div>
      </div>
      <div class="lg-link">{{ layer.linkLabel }}</div>
    </a>
  </div>
</template>

<style scoped>
.lg {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}
.lg-card {
  display: flex;
  flex-direction: column;
  padding: 20px 20px 0;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 10px;
  text-decoration: none;
  color: inherit;
  min-width: 0;
  transition: border-color 0.2s, transform 0.2s;
}
.lg-card:hover {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 40%, var(--ea-divider));
  transform: translateY(-2px);
}
.lg-tag {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--vp-c-brand-1);
  letter-spacing: 0.02em;
  margin-bottom: 8px;
  text-transform: lowercase;
}
.lg-title {
  font-family: var(--vp-font-family-mono);
  font-size: 16px;
  font-weight: 600;
  color: var(--ea-text-1);
  margin: 0 0 8px;
  letter-spacing: 0.005em;
}
.lg-body {
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--ea-text-2);
  margin: 0 0 16px;
  flex: 1;
}
.lg-code {
  margin: 0 -20px;
  padding: 12px 20px;
  background: var(--ea-surface-alt);
  border-top: 1px solid var(--ea-divider);
  border-bottom: 1px solid var(--ea-divider);
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--ea-text-1);
  /* Reserve room for 3 lines so every panel aligns across the row. */
  min-height: calc(3 * 1.7em + 24px);
  box-sizing: border-box;
  min-width: 0;
}
.lg-code-line {
  color: var(--ea-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.lg-link {
  padding: 12px 0 14px;
  font-family: var(--vp-font-family-base);
  font-size: 13px;
  font-weight: 500;
  color: var(--vp-c-brand-1);
}

@media (max-width: 1100px) {
  .lg {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 600px) {
  .lg {
    grid-template-columns: 1fr;
  }
  .lg-code {
    min-height: 0;
  }
}
</style>
