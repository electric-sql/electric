<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { VPButton } from 'vitepress/theme'
import HomeIsoBg from './HomeIsoBg.vue'
import type { CropName } from './iso/types'

// On narrow viewports we collapse to a single column and the iso
// scene's horizontal bleed (~55 % of the cell) would push the page
// content past the viewport edge, forcing horizontal scroll. Switch
// bleed off below the breakpoint.
const isNarrow = ref(false)
let bleedMql: MediaQueryList | null = null
function syncNarrow() {
  isNarrow.value = !!bleedMql?.matches
}
onMounted(() => {
  if (typeof window === 'undefined') return
  bleedMql = window.matchMedia('(max-width: 1099px)')
  syncNarrow()
  bleedMql.addEventListener('change', syncNarrow)
})
onUnmounted(() => {
  bleedMql?.removeEventListener('change', syncNarrow)
})

type Product = 'agents' | 'streams' | 'sync'

const props = defineProps<{
  product: Product
  /** Render with a dark band background. */
  dark?: boolean
}>()

interface Copy {
  eyebrow: string
  title: string
  sub: string
  cta: { text: string; href: string }
  secondary: { text: string; href: string }
  crop: CropName
  /** Side the iso scene sits on. Text takes the other side. */
  sceneSide: 'left' | 'right'
}

const COPY: Record<Product, Copy> = {
  agents: {
    eyebrow: 'Electric Agents',
    title: 'Agents that participate, not just&nbsp;respond.',
    sub: 'Durable, serverless agents that share state with humans, hand off work, and never lose a thread.',
    cta: { text: 'Explore Agents »', href: '/agents' },
    secondary: { text: 'Quickstart', href: '/docs/agents/quickstart' },
    crop: 'coordination-floor',
    sceneSide: 'left',
  },
  streams: {
    eyebrow: 'Durable Streams',
    title: 'A live substrate for in-flight&nbsp;work.',
    sub: 'Persistent, addressable, real-time streams over plain HTTP. Branch, replay, fan out over CDN.',
    cta: { text: 'Explore Streams »', href: '/streams' },
    secondary: { text: 'Read the spec', href: 'https://durablestreams.com' },
    crop: 'substrate-cutaway',
    sceneSide: 'right',
  },
  sync: {
    eyebrow: 'Electric Sync',
    title: 'One source of truth, on every&nbsp;surface.',
    sub: 'Sync subsets of Postgres into everything. Sub-millisecond live updates. Multi-user, multi-agent.',
    cta: { text: 'Explore Sync »', href: '/sync' },
    secondary: { text: 'Quickstart', href: '/docs/quickstart' },
    crop: 'mirrored-surfaces',
    sceneSide: 'left',
  },
}

const copy = computed(() => COPY[props.product])
const sceneFirst = computed(() => copy.value.sceneSide === 'left')

// Bleed for the iso scene. We extend horizontally to the outside page
// edge (~55 % of the scene cell) so the vignette feels continuous with
// the page band, but we deliberately keep vertical bleed at 0 — the
// section is `overflow-y: hidden`, and a vertical bleed would either be
// clipped (looking abrupt) or leak into neighbouring sections. The
// feather mask still gives a soft top/bottom fade *within* the cell.
// `streams` stays boxed so it gets no bleed at all. On mobile we drop
// the bleed entirely — the layout collapses to single-column so the
// scene already spans the full content width and any extra bleed would
// push the page past the viewport edge.
const sceneBleed = computed(() => {
  if (copy.value.crop === 'substrate-cutaway') return 0
  if (isNarrow.value) return 0
  if (copy.value.sceneSide === 'left') {
    return { top: 0, right: 0, bottom: 0, left: 0.55 }
  }
  return { top: 0, right: 0.55, bottom: 0, left: 0 }
})
</script>

<template>
  <section
    class="home-product"
    :class="{
      'home-product--alt': props.dark,
      'scene-first': sceneFirst,
      'home-product--boxed': props.product === 'streams',
    }"
  >
    <div class="home-product-band">
      <div class="home-product-inner">
      <div class="home-product-grid">
        <div class="home-product-scene">
          <ClientOnly>
            <HomeIsoBg
              :crop="copy.crop"
              :auto-start="false"
              :zoom="1.15"
              :bleed="sceneBleed"
              :feather="!props.dark && props.product !== 'streams'"
            />
          </ClientOnly>
        </div>
        <div class="home-product-text">
          <p class="home-product-eyebrow">{{ copy.eyebrow }}</p>
          <h2 class="home-product-title" v-html="copy.title" />
          <p class="home-product-sub">{{ copy.sub }}</p>
          <div class="home-product-actions">
            <VPButton
              tag="a"
              size="medium"
              theme="brand"
              :text="copy.cta.text"
              :href="copy.cta.href"
            />
            <VPButton
              tag="a"
              size="medium"
              theme="alt"
              :text="copy.secondary.text"
              :href="copy.secondary.href"
            />
          </div>
        </div>
      </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Same outer-full-bleed / inner-max-width pattern as the landing pages.
   The `--alt` variant just adds a background colour and naturally reaches
   the viewport edges. */
.home-product {
  position: relative;
  padding: 80px 24px;
  border-bottom: 1px solid var(--vp-c-divider);
  /* Allow the iso scene to bleed horizontally past the inner content
     column, but clip vertically so it can't leak into neighbouring
     sections. */
  overflow-x: clip;
  overflow-y: hidden;
}

/* Unboxed variants (agents + sync): kill the section's vertical padding
   so the iso scene actually touches the top/bottom of its section band,
   then put that padding back on the text column only so the headline
   keeps its breathing room. */
.home-product:not(.home-product--boxed) {
  padding-top: 0;
  padding-bottom: 0;
}
.home-product:not(.home-product--boxed) .home-product-text {
  padding-top: 80px;
  padding-bottom: 80px;
}

.home-product--alt {
  background: var(--vp-sidebar-bg-color);
}

.home-product-band {
  max-width: 100%;
}

.home-product-inner {
  max-width: 1152px;
  margin: 0 auto;
}

.home-product-grid {
  display: grid;
  grid-template-columns: 7fr 5fr;
  gap: 48px;
  align-items: center;
}

/* When `scene-first` (sceneSide === 'left'), put the scene first; the
   default grid order has it first anyway. When NOT scene-first, swap. */
.home-product:not(.scene-first) .home-product-scene {
  order: 2;
}
.home-product:not(.scene-first) .home-product-text {
  order: 1;
}
.home-product:not(.scene-first) .home-product-grid {
  grid-template-columns: 5fr 7fr;
}

.home-product-scene {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  min-height: 320px;
  max-height: 480px;
  /* No `overflow: hidden` on the unboxed variants — the iso canvas uses
     `bleed` to extend past this slot toward the page edge. The page-band
     `.home-product` still has implicit clipping via the surrounding
     layout. */
}

/* Streams is the only vignette rendered as a contained card; the others
   bleed to the edges of their grid cell so the substrate / surfaces feel
   continuous with the page. */
.home-product--boxed .home-product-scene {
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--ea-surface-alt);
  overflow: hidden;
}

.home-product-eyebrow {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ea-text-3);
  margin: 0 0 14px;
}

.home-product-title {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.015em;
  color: var(--ea-text-1);
  margin: 0;
}

.home-product-sub {
  font-size: 17px;
  font-weight: 500;
  color: var(--ea-text-2);
  line-height: 1.5;
  margin: 16px 0 0;
  max-width: 480px;
}

.home-product-actions {
  margin-top: 28px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

/* Match the hero's collapse breakpoint (1099) so the whole homepage
   transitions to single-column at the same width. Avoids a "mobile
   hero, desktop product sections" Frankenstein gap between 960–1099 px. */
@media (max-width: 1099px) {
  .home-product-grid {
    grid-template-columns: 1fr !important;
    gap: 28px;
  }
  .home-product:not(.scene-first) .home-product-scene,
  .home-product:not(.scene-first) .home-product-text {
    order: initial;
  }
  .home-product-scene {
    aspect-ratio: 16 / 9;
    min-height: 240px;
    /* When stacked, scene goes above text so the visual leads. */
    order: -1;
  }
}

@media (max-width: 768px) {
  .home-product {
    padding: 56px 20px;
  }
  .home-product:not(.home-product--boxed) {
    padding-top: 0;
    padding-bottom: 0;
  }
  .home-product:not(.home-product--boxed) .home-product-text {
    padding-top: 56px;
    padding-bottom: 56px;
  }
  .home-product-title {
    font-size: 26px;
  }
  .home-product-sub {
    font-size: 15px;
  }
}

@media (max-width: 480px) {
  .home-product {
    padding: 40px 16px;
  }
  .home-product:not(.home-product--boxed) {
    padding-top: 0;
    padding-bottom: 0;
  }
  .home-product:not(.home-product--boxed) .home-product-text {
    padding-top: 40px;
    padding-bottom: 40px;
  }
}
</style>
