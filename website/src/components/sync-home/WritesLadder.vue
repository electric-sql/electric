<script setup lang="ts">
// Section 5: "Bring your own writes".
// A short ladder showing the spectrum of write patterns. Electric reads
// sync, but writes stay in your stack — and you can pick how much sync
// you want on top.
import { computed } from 'vue'
import MarkdownContent from '../MarkdownContent.vue'
import MdExportExplicit from '../MdExportExplicit.vue'
import { useMarkdownExport } from '../../lib/useMarkdownExport'

interface Tile {
  id: string
  label: string
  title: string
  body: string
  href?: string
}

const tiles: Tile[] = [
  {
    id: "api",
    label: "Plain API",
    title: "Write through your API",
    body: "POST or PUT to your existing endpoints. The Postgres txid flows back through the read path.",
    href: "/docs/sync/guides/writes#through-the-db",
  },
  {
    id: "shared",
    title: "Shared write path",
    label: "API + clients",
    body: "Many clients hit the same backend. Sync delivers the same change to every reader.",
    href: "/docs/sync/guides/writes#shared-write-path",
  },
  {
    id: "optimistic",
    title: "Optimistic mutations",
    label: "+ TanStack DB",
    body: "UI updates instantly. The collection awaits the txid on the stream and reconciles.",
    href: "/sync/tanstack-db",
  },
]

const isMarkdownExport = useMarkdownExport()

const markdown = computed(() =>
  tiles
    .map((tile, index) => {
      const link = tile.href ? ` [Learn more](${tile.href})` : ''
      return `${index + 1}. **${tile.title}** (${tile.label}). ${tile.body}${link}`
    })
    .join('\n')
)
</script>

<template>
  <MdExportExplicit v-if="isMarkdownExport">
    <MarkdownContent>{{ markdown }}</MarkdownContent>
  </MdExportExplicit>
  <div v-else class="writes-ladder">
    <div
      v-for="(tile, i) in tiles"
      :key="tile.id"
      class="wl-tile"
    >
      <div class="wl-tile-num mono">{{ String(i + 1).padStart(2, "0") }}</div>
      <div class="wl-tile-label mono">{{ tile.label }}</div>
      <h4 class="wl-tile-title">{{ tile.title }}</h4>
      <p class="wl-tile-body">{{ tile.body }}</p>
      <a v-if="tile.href" class="wl-tile-link" :href="tile.href">Learn more →</a>
    </div>
  </div>
</template>

<style scoped>
.writes-ladder {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  align-items: stretch;
}

.wl-tile {
  position: relative;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  padding: 22px 22px 20px;
  display: flex;
  flex-direction: column;
  transition: border-color 0.2s;
}
.wl-tile:hover {
  border-color: var(--vp-c-brand-1);
}

.wl-tile-num {
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--ea-text-3);
  text-transform: uppercase;
}

.wl-tile-label {
  font-size: 11.5px;
  color: var(--vp-c-brand-1);
  margin-top: 4px;
  letter-spacing: 0.02em;
}

.wl-tile-title {
  margin: 6px 0 12px;
  font-size: 16px;
  font-weight: 600;
  color: var(--ea-text-1);
  line-height: 1.3;
}

.wl-tile-body {
  margin: 0 0 12px;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--ea-text-2);
  flex: 1;
}

.wl-tile-link {
  font-size: 12.5px;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  font-weight: 500;
}
.wl-tile-link:hover {
  text-decoration: underline;
}

/* ── Responsive ─────────────────────────────────────────────────── */

@media (max-width: 860px) {
  .writes-ladder {
    grid-template-columns: 1fr;
    gap: 14px;
  }
}

@media (max-width: 540px) {
  .wl-tile {
    padding: 18px 18px 16px;
  }
}
</style>
