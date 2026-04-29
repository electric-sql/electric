<script setup lang="ts">
import MarkdownContent from '../MarkdownContent.vue'
import MdExportExplicit from '../MdExportExplicit.vue'
import { useMarkdownExport } from '../../lib/useMarkdownExport'

interface Card {
  img?: string
  svg?: string
  name: string
  body: string
  docs: string
  blog: string | null
}

// Inline Vercel mark using currentColor so it adapts to light/dark themes
// (the canonical /img/icons/vercel.svg is hard-filled white for use on
// dark surfaces only, which doesn't read against the light card here).
const VERCEL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 76 76" aria-hidden="true">
  <path fill="currentColor" d="M38 6L71 64H5L38 6Z"/>
</svg>`

const cards: Card[] = [
  {
    img: '/img/icons/tanstack.svg',
    name: 'TanStack AI',
    body: 'Durable connection adapter. Resumable, shareable AI sessions across tabs and devices.',
    docs: '/docs/streams/integrations/tanstack-ai',
    blog: '/blog/2026/01/12/durable-sessions-for-collaborative-ai',
  },
  {
    svg: VERCEL_SVG,
    name: 'Vercel AI SDK',
    body: 'Durable Transport for the AI SDK. Drop-in replacement for streamText transport.',
    docs: '/docs/streams/integrations/vercel-ai-sdk',
    blog: '/blog/2026/03/24/durable-transport-ai-sdks',
  },
]

const markdownCards = cards
  .map((card) => {
    const links = [`[Docs](${card.docs})`]
    if (card.blog) links.push(`[Blog post](${card.blog})`)

    return `### ${card.name}

${card.body}

${links.join(' · ')}`
  })
  .join('\n\n')

const isMarkdownExport = useMarkdownExport()
</script>

<template>
  <MdExportExplicit v-if="isMarkdownExport">
    <MarkdownContent>{{ markdownCards }}</MarkdownContent>
  </MdExportExplicit>
  <div v-else class="ig">
    <a v-for="card in cards" :key="card.name" :href="card.docs" class="ig-card">
      <div class="ig-head">
        <span class="ig-glyph">
          <img v-if="card.img" :src="card.img" :alt="card.name" />
          <span v-else-if="card.svg" v-html="card.svg" />
        </span>
        <span class="ig-name">{{ card.name }}</span>
      </div>
      <p class="ig-body">{{ card.body }}</p>
      <div class="ig-divider" />
      <div class="ig-links">
        <span class="ig-link">Docs →</span>
        <a v-if="card.blog" :href="card.blog" class="ig-link" @click.stop>
          Blog post →
        </a>
      </div>
    </a>
  </div>
</template>

<style scoped>
.ig {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}
.ig-card {
  display: flex;
  flex-direction: column;
  padding: 22px 24px;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 10px;
  text-decoration: none;
  color: inherit;
  transition:
    border-color 0.2s,
    transform 0.2s;
}
.ig-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}
.ig-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.ig-glyph {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ea-text-1);
  flex-shrink: 0;
}
.ig-glyph img,
.ig-glyph :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
}
.ig-name {
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  font-weight: 700;
  color: var(--ea-text-1);
}
.ig-body {
  font-size: 14px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 0 0 16px;
  flex: 1;
}
.ig-divider {
  height: 1px;
  background: var(--ea-divider);
  margin-bottom: 12px;
}
.ig-links {
  display: flex;
  gap: 22px;
  font-size: 13px;
  font-weight: 500;
}
.ig-link {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.ig-link:hover {
  text-decoration: underline;
}
@media (max-width: 768px) {
  .ig {
    grid-template-columns: 1fr;
  }
}
</style>
