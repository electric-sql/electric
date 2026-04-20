<script setup lang="ts">
import { computed } from 'vue'
import { VPButton } from 'vitepress/theme'

type Product = 'agents' | 'streams' | 'sync'

const props = defineProps<{
  product: Product
  /** Render with a dark band background. */
  dark?: boolean
}>()

interface Copy {
  eyebrow: string
  name: string
  title: string
  sub: string
  cta: { text: string; href: string }
  secondary: { text: string; href: string }
  /** Side the iso scene sits on. Text takes the other side. */
  sceneSide: 'left' | 'right'
}

const COPY: Record<Product, Copy> = {
  agents: {
    eyebrow: 'Agent runtime',
    name: 'Electric Agents',
    title: 'The runtime for long-lived agents',
    sub: 'Agents live as durable, synced entities — resumable across devices, observable across teams, forkable for review and experimentation.',
    cta: { text: 'Explore Agents »', href: '/agents' },
    secondary: { text: 'Quickstart', href: '/docs/agents/quickstart' },
    sceneSide: 'left',
  },
  streams: {
    eyebrow: 'Data primitive',
    name: 'Electric Streams',
    title: 'The data primitive for the agent loop',
    sub: 'Persistent, addressable, real-time streams — a flexible, swiss-army-knife data primitive for agent session data.',
    cta: { text: 'Explore Streams »', href: '/streams' },
    secondary: { text: 'Read the spec', href: 'https://durablestreams.com' },
    sceneSide: 'right',
  },
  sync: {
    eyebrow: 'Sync engine',
    name: 'Electric Sync',
    title: 'The core sync engine technology',
    sub: 'Compostable sync primitives that power end-to-end reactivity and collaboration for multi-agent systems.',
    cta: { text: 'Explore Sync »', href: '/sync' },
    secondary: { text: 'Quickstart', href: '/docs/quickstart' },
    sceneSide: 'left',
  },
}

const copy = computed(() => COPY[props.product])
const sceneFirst = computed(() => copy.value.sceneSide === 'left')
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
          <div class="home-product-placeholder" aria-label="Homepage section graphic placeholder">
            TBD
          </div>
        </div>
        <div class="home-product-text">
          <p class="home-product-eyebrow">{{ copy.eyebrow }}</p>
          <p class="home-product-name">{{ copy.name }}</p>
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
}

.home-product-placeholder {
  position: absolute;
  inset: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--vp-c-divider);
  border-radius: 14px;
  background: transparent;
  color: var(--ea-text-3);
  font-family: var(--vp-font-family-mono);
  font-size: 18px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.home-product-eyebrow {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ea-text-3);
  margin: 0 0 10px;
}

.home-product-name {
  font-size: 42px;
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: -0.02em;
  color: var(--ea-text-1);
  margin: 0 0 12px;
}

.home-product-title {
  font-size: 28px;
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
  .home-product-name {
    font-size: 34px;
  }
  .home-product-title {
    font-size: 24px;
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
