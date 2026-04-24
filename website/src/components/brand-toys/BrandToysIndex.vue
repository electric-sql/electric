<script setup lang="ts">
/* BrandToysIndex — the /brand-toys landing page.
   ────────────────────────────────────────────────
   Flat, searchable grid of every registered toy. Clicking a card
   navigates to `/brand-toys?id=<slug>` which mounts the toy stage. */

import { computed, ref } from "vue"

import {
  GROUP_LABELS,
  GROUP_ORDER,
  TOYS,
  isAnimated,
  type ToyGroup,
  type ToyDef,
} from "./toys"

type AnimationFilter = "all" | "animated" | "static"

const query = ref("")
const activeGroup = ref<ToyGroup | "all">("all")
const animationFilter = ref<AnimationFilter>("all")

const filtered = computed<ToyDef[]>(() => {
  const q = query.value.trim().toLowerCase()
  return TOYS.filter((t) => {
    if (activeGroup.value !== "all" && t.group !== activeGroup.value) {
      return false
    }
    if (animationFilter.value === "animated" && !isAnimated(t)) return false
    if (animationFilter.value === "static" && isAnimated(t)) return false
    if (!q) return true
    return (
      t.label.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q) ||
      (t.description?.toLowerCase().includes(q) ?? false) ||
      t.source.toLowerCase().includes(q)
    )
  })
})

const groupCounts = computed<Record<ToyGroup, number>>(() => {
  const c: Record<string, number> = {}
  for (const g of GROUP_ORDER) c[g] = 0
  for (const t of TOYS) c[t.group] = (c[t.group] ?? 0) + 1
  return c as Record<ToyGroup, number>
})

const animatedCount = computed(() => TOYS.filter(isAnimated).length)
const staticCount = computed(() => TOYS.length - animatedCount.value)

function hrefFor(t: ToyDef) {
  return `/brand-toys?id=${encodeURIComponent(t.id)}`
}

// Handle the in-page navigation ourselves rather than letting
// VitePress' SPA router intercept the anchor click. Both URLs are
// `/brand-toys` (only the query string differs), so VitePress fires
// `history.pushState` but does *not* re-mount the page component —
// `BrandToysPage` would never see the new `?id=…` and we'd appear
// stuck on the index. We push the new URL ourselves and dispatch a
// custom event that `BrandToysPage` listens for.
//
// Modifier-clicks (cmd/ctrl/shift/middle-click) fall through to the
// browser so "open in new tab" still works.
function onCardClick(e: MouseEvent, t: ToyDef) {
  if (
    e.defaultPrevented ||
    e.button !== 0 ||
    e.metaKey ||
    e.ctrlKey ||
    e.shiftKey ||
    e.altKey
  ) {
    return
  }
  e.preventDefault()
  const url = hrefFor(t)
  if (typeof window !== "undefined") {
    window.history.pushState({}, "", url)
    window.dispatchEvent(new CustomEvent("brand-toys:navigate"))
    window.scrollTo(0, 0)
  }
}

function groupClass(g: string) {
  return `group-${g}`
}

// Strip the noisy `src/components/` prefix so the on-card path stays
// short and scannable. The full path is preserved in the `title`.
function shortPath(source: string): string {
  return source.replace(/^src\/components\//, "")
}
</script>

<template>
  <div class="bt-index">
    <header class="bt-index-head">
      <div class="bt-index-eyebrow mono">Electric</div>
      <h1 class="bt-index-title">Brand Toys</h1>
      <p class="bt-index-sub">
        Every animated scene and widget from the marketing site, in a
        resizable recording stage with per-toy controls. Unlinked from
        the nav — bookmark this URL. Not indexed, not listed.
      </p>
    </header>

    <div class="bt-index-bar">
      <input
        v-model="query"
        type="search"
        class="bt-index-search"
        placeholder="Search toys by name, id, description…"
        autofocus
      />
      <div class="bt-index-chips">
        <button
          type="button"
          class="bt-index-chip"
          :class="{ active: activeGroup === 'all' }"
          @click="activeGroup = 'all'"
        >
          all · {{ TOYS.length }}
        </button>
        <button
          v-for="g in GROUP_ORDER"
          :key="g"
          type="button"
          class="bt-index-chip"
          :class="[{ active: activeGroup === g }, groupClass(g)]"
          @click="activeGroup = g"
        >
          {{ GROUP_LABELS[g].toLowerCase() }} · {{ groupCounts[g] }}
        </button>
      </div>
      <div class="bt-index-chips bt-index-tagrow">
        <span class="bt-index-tagrow-label mono">tag</span>
        <button
          type="button"
          class="bt-index-chip tag-any"
          :class="{ active: animationFilter === 'all' }"
          @click="animationFilter = 'all'"
        >
          any
        </button>
        <button
          type="button"
          class="bt-index-chip tag-animated"
          :class="{ active: animationFilter === 'animated' }"
          @click="animationFilter = 'animated'"
        >
          animated · {{ animatedCount }}
        </button>
        <button
          type="button"
          class="bt-index-chip tag-static"
          :class="{ active: animationFilter === 'static' }"
          @click="animationFilter = 'static'"
        >
          static · {{ staticCount }}
        </button>
      </div>
    </div>

    <div v-if="filtered.length === 0" class="bt-index-empty">
      No toys match the current filter.
    </div>

    <ul v-else class="bt-index-grid">
      <li v-for="t in filtered" :key="t.id" class="bt-index-card">
        <a
          :href="hrefFor(t)"
          class="bt-index-card-link"
          @click="onCardClick($event, t)"
        >
          <div class="bt-index-card-head">
            <span class="bt-index-card-group mono" :class="groupClass(t.group)">
              {{ GROUP_LABELS[t.group] }}
            </span>
            <span
              class="bt-index-card-tag mono"
              :class="isAnimated(t) ? 'tag-animated' : 'tag-static'"
              :title="isAnimated(t) ? 'Toy moves on its own' : 'Static layout — no animation'"
            >
              {{ isAnimated(t) ? 'animated' : 'static' }}
            </span>
            <span v-if="t.fullBleed" class="bt-index-card-tag mono">bg</span>
            <span v-if="t.clientOnly" class="bt-index-card-tag mono">wasm</span>
          </div>
          <h3 class="bt-index-card-title">{{ t.label }}</h3>
          <p v-if="t.description" class="bt-index-card-desc">
            {{ t.description }}
          </p>
          <div class="bt-index-card-foot mono">
            <span class="bt-index-card-id">{{ t.id }}</span>
            <span v-if="t.controls && t.controls.length" class="bt-index-card-ctrls">
              {{ t.controls.length }} control{{ t.controls.length === 1 ? '' : 's' }}
            </span>
          </div>
          <div class="bt-index-card-path mono" :title="t.source">
            {{ shortPath(t.source) }}
          </div>
        </a>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.bt-index {
  min-height: 100vh;
  background: var(--ea-bg);
  color: var(--ea-text-1);
  padding: 72px 48px 120px;
  font-family: var(--vp-font-family-base, system-ui, sans-serif);
}

.bt-index-head {
  max-width: 960px;
  margin: 0 0 48px;
}
.bt-index-eyebrow {
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ea-text-3);
}
.bt-index-title {
  font-size: 44px;
  font-weight: 600;
  margin: 8px 0 10px;
  letter-spacing: -0.01em;
  color: var(--ea-text-1);
}
.bt-index-sub {
  font-size: 15px;
  color: var(--ea-text-2);
  margin: 0;
  max-width: 680px;
  line-height: 1.5;
}

.bt-index-bar {
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--ea-bg);
  padding: 16px 0 16px;
  margin-bottom: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.bt-index-search {
  width: 100%;
  max-width: 560px;
  background: var(--ea-surface);
  border: 1px solid var(--vp-c-divider);
  color: var(--ea-text-1);
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 15px;
  font-family: inherit;
}
.bt-index-search:focus {
  outline: none;
  border-color: var(--vp-c-brand-1);
}

.bt-index-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.bt-index-chip {
  background: var(--ea-surface);
  border: 1px solid var(--vp-c-divider);
  color: var(--ea-text-2);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12px;
  font-family: var(--vp-font-family-mono, ui-monospace, monospace);
  cursor: pointer;
  letter-spacing: 0.02em;
}
.bt-index-chip:hover {
  color: var(--ea-text-1);
}
.bt-index-chip.active {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--ea-text-1);
}

/* Secondary tag row — narrower visual weight than the group chips. */
.bt-index-tagrow {
  align-items: center;
  gap: 6px;
}
.bt-index-tagrow-label {
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ea-text-3);
  margin-right: 2px;
}
.bt-index-chip.tag-animated.active {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
.bt-index-chip.tag-static.active {
  background: var(--ea-surface-alt);
  border-color: var(--vp-c-divider);
  color: var(--ea-text-1);
}

.bt-index-grid {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.bt-index-card {
  background: var(--ea-surface);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  transition:
    border-color 0.15s ease,
    transform 0.15s ease;
}
.bt-index-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-1px);
}

.bt-index-card-link {
  display: block;
  padding: 16px 16px 14px;
  color: inherit;
  text-decoration: none;
}

.bt-index-card-head {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 10px;
}
.bt-index-card-group {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 3px;
  background: var(--ea-surface-alt);
  color: var(--ea-text-2);
}
.bt-index-card-tag {
  font-size: 9px;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(255, 193, 7, 0.15);
  color: rgba(255, 193, 7, 0.85);
}
.bt-index-card-tag.tag-animated {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}
.bt-index-card-tag.tag-static {
  background: var(--ea-surface-alt);
  color: var(--ea-text-2);
}

.bt-index-card-group.group-hero {
  background: rgba(56, 189, 248, 0.14);
  color: #7dd3fc;
}
.bt-index-card-group.group-sync {
  background: rgba(167, 139, 250, 0.14);
  color: #c4b5fd;
}
.bt-index-card-group.group-agents {
  background: rgba(34, 197, 94, 0.14);
  color: #86efac;
}
.bt-index-card-group.group-streams {
  background: rgba(249, 115, 22, 0.14);
  color: #fdba74;
}
.bt-index-card-group.group-cloud {
  background: rgba(236, 72, 153, 0.14);
  color: #f9a8d4;
}
.bt-index-card-group.group-home {
  background: rgba(250, 204, 21, 0.14);
  color: #fde68a;
}
.bt-index-card-group.group-misc {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
}

.bt-index-card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ea-text-1);
  margin: 0 0 6px;
  line-height: 1.3;
}
.bt-index-card-desc {
  font-size: 12.5px;
  color: var(--ea-text-2);
  line-height: 1.45;
  margin: 0 0 14px;
}
.bt-index-card-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10.5px;
  color: var(--ea-text-3);
  gap: 8px;
}
.bt-index-card-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bt-index-card-path {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--vp-c-divider);
  font-size: 10.5px;
  color: var(--ea-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}

.bt-index-empty {
  color: var(--ea-text-3);
  font-style: italic;
  padding: 40px 0;
}

.mono {
  font-family: var(--vp-font-family-mono, ui-monospace, monospace);
}
</style>
