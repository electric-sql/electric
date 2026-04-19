<script setup lang="ts">
interface Card {
  glyph?: string
  svg?: string
  name: string
  body: string
  docs: string
  blog: string | null
}

// Single-colour TanStack mark, recoloured via currentColor so it inherits
// the brand tint set on .ig-glyph.
const TANSTACK_SVG = `<svg viewBox="0 0 264 264" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M136.992 53.1244C137.711 52.4029 138.683 52 139.692 52H200L114.008 138.089C113.289 138.811 112.317 139.213 111.308 139.213H51L136.992 53.1244Z" fill="currentColor" />
  <path d="M126.416 141.125C126.416 140.066 127.275 139.204 128.331 139.204H200L126.416 213V141.125Z" fill="currentColor" />
</svg>`

const cards: Card[] = [
  {
    svg: TANSTACK_SVG,
    name: "TanStack AI",
    body: "Durable connection adapter. Resumable, shareable AI sessions across tabs and devices.",
    docs: "/docs/streams/integrations/tanstack-ai",
    blog: "/blog/2026/01/12/durable-sessions-for-collaborative-ai",
  },
  {
    glyph: "▲",
    name: "Vercel AI SDK",
    body: "Durable Transport for the AI SDK. Drop-in replacement for streamText transport.",
    docs: "/docs/streams/integrations/vercel-ai-sdk",
    blog: "/blog/2026/03/24/durable-transport-ai-sdks",
  },
]
</script>

<template>
  <div class="ig">
    <a
      v-for="card in cards"
      :key="card.name"
      :href="card.docs"
      class="ig-card"
    >
      <div class="ig-head">
        <span class="ig-glyph" :class="{ 'ig-glyph--svg': card.svg }">
          <span v-if="card.svg" v-html="card.svg" />
          <template v-else>{{ card.glyph }}</template>
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
  transition: border-color 0.2s, transform 0.2s;
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
  font-family: var(--vp-font-family-mono);
  font-size: 18px;
  color: var(--vp-c-brand-1);
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 30%, var(--ea-divider));
  border-radius: 6px;
  background: color-mix(in srgb, var(--vp-c-brand-1) 5%, transparent);
}
.ig-glyph--svg :deep(svg) {
  width: 18px;
  height: 18px;
  display: block;
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
