<script setup lang="ts">
import MarkdownContent from "../MarkdownContent.vue"
import MdExportExplicit from "../MdExportExplicit.vue"
import { useMarkdownExport } from "../../lib/useMarkdownExport"

const cards = [
  {
    glyph: "{ url }",
    title: "URL-addressable",
    body: "Every stream lives at its own URL. Works with curl, fetch, any load balancer, any CDN.",
    code: [
      "PUT   /v1/stream/hello",
      "POST  /v1/stream/hello",
      "GET   /v1/stream/hello",
    ],
  },
  {
    glyph: "▤ append-only",
    title: "Append-only",
    body: "Once data is at an offset, it never changes. Offsets are opaque cursors that always sort in order.",
    code: [
      "POST  → 200 OK",
      "      Stream-Next-Offset:",
      "         01JQXK5V00",
    ],
  },
  {
    glyph: "↻ resumable",
    title: "Resumable",
    body: "Reads return Stream-Next-Offset. Reconnect with ?offset=… and pick up exactly where you left off.",
    code: [
      "GET ?offset=01JQXK5V00",
      "    → next chunk only",
    ],
  },
]

const markdownCards = cards
  .map(
    (card) => `### ${card.title}

${card.body}

\`\`\`
${card.code.join("\n")}
\`\`\``
  )
  .join("\n\n")

const isMarkdownExport = useMarkdownExport()
</script>

<template>
  <MdExportExplicit v-if="isMarkdownExport">
    <MarkdownContent>{{ markdownCards }}</MarkdownContent>
  </MdExportExplicit>
  <div v-else class="tpg">
    <div v-for="card in cards" :key="card.title" class="tpg-card">
      <div class="tpg-glyph">{{ card.glyph }}</div>
      <h3 class="tpg-title">{{ card.title }}</h3>
      <p class="tpg-body">{{ card.body }}</p>
      <div class="tpg-code">
        <div v-for="(line, i) in card.code" :key="i" class="tpg-code-line">{{ line }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tpg {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
.tpg-card {
  display: flex;
  flex-direction: column;
  padding: 22px 22px 0;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 10px;
  transition: border-color 0.2s, transform 0.2s;
}
.tpg-card:hover {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 40%, var(--ea-divider));
}
.tpg-glyph {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-brand-1);
  letter-spacing: 0.02em;
  margin-bottom: 10px;
}
.tpg-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--ea-text-1);
  margin: 0 0 8px;
}
.tpg-body {
  font-size: 14px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 0 0 18px;
  flex: 1;
}
.tpg-code {
  margin: 0 -22px;
  padding: 14px 22px;
  background: var(--ea-surface-alt);
  border-top: 1px solid var(--ea-divider);
  border-radius: 0 0 10px 10px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  line-height: 1.7;
  color: var(--ea-text-1);
  white-space: pre;
  overflow-x: auto;
  /* Reserve room for 3 lines so all three cards align across the row. */
  min-height: calc(3 * 1.7em + 28px);
  box-sizing: border-box;
}
.tpg-code-line {
  color: var(--ea-text-1);
}
@media (max-width: 960px) {
  .tpg {
    grid-template-columns: 1fr;
  }
}
</style>
