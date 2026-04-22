<script setup lang="ts">
import { computed, ref } from 'vue'
import { VPButton } from 'vitepress/theme'

// We deliberately reuse the canvas hero backgrounds from each
// landing page so the homepage section graphics share line weight,
// fade, comet tails and hover behaviour with their corresponding
// `/agents`, `/streams`, `/sync` heros pixel-for-pixel.
import HeroNetworkBg from '../agents-home/HeroNetworkBg.vue'
import StreamFlowBg from '../streams-home/StreamFlowBg.vue'
import SyncFanOutBg from '../sync-home/SyncFanOutBg.vue'
// One representative demo from each landing page is pulled into
// the section's scene cell as a paused snapshot. Each demo
// supports a `paused` prop that swaps the visibility-driven
// animation loop for a fixed mid-flight state, so the homepage
// reads as a curated frame of the live experience without
// competing with the section copy for attention.
import SystemMonitorDemo from '../agents-home/SystemMonitorDemo.vue'
import CollabSessionDemo from '../streams-home/CollabSessionDemo.vue'
import MultiClientPulseDemo from '../sync-home/MultiClientPulseDemo.vue'

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
    title: 'The runtime for long-lived&nbsp;agents',
    sub: 'Agents live as durable, synced entities — resumable across devices, observable across teams, forkable for review and experimentation.',
    cta: { text: 'Explore Agents »', href: '/agents' },
    secondary: { text: 'Quickstart', href: '/docs/agents/quickstart' },
    sceneSide: 'left',
  },
  streams: {
    eyebrow: 'Data primitive',
    name: 'Electric Streams',
    title: 'The data primitive for the agent&nbsp;loop',
    sub: 'Persistent, addressable, real-time streams — a flexible, swiss-army-knife data primitive for agent session data.',
    cta: { text: 'Explore Streams »', href: '/streams' },
    secondary: { text: 'Quickstart', href: '/docs/streams/quickstart' },
    sceneSide: 'right',
  },
  sync: {
    eyebrow: 'Sync engine',
    name: 'Electric Sync',
    title: 'The core sync engine&nbsp;technology',
    sub: 'Composable sync primitives that power end-to-end reactivity and collaboration for multi-agent systems.',
    cta: { text: 'Explore Sync »', href: '/sync' },
    secondary: { text: 'Quickstart', href: '/docs/quickstart' },
    sceneSide: 'left',
  },
}

const copy = computed(() => COPY[props.product])
const sceneFirst = computed(() => copy.value.sceneSide === 'left')

// Used by the underlying canvas (`HeroNetworkBg`/`StreamFlowBg`/
// `SyncFanOutBg`) as the rectangle to avoid when laying out
// geometry — mirrors the `excludeEl` pattern used by each landing
// page hero so text never has a node, rail or shape sitting under it.
const textRef = ref<HTMLElement>()

// Pick the right canvas hero background for this product. Reusing the
// existing hero-bg component verbatim guarantees that the homepage
// section graphic looks like the corresponding landing-page hero —
// same line weight, same hover-to-reveal labels, same uniform sync
// grid, same comet tails. No `excludeEl` is passed so the canvas can
// fully populate the smaller framed scene.
const graphic = computed(() => {
  switch (props.product) {
    case 'agents':
      return HeroNetworkBg
    case 'streams':
      return StreamFlowBg
    case 'sync':
      return SyncFanOutBg
  }
})

// Foreground demo for the scene cell. Each lives on the
// corresponding landing page; here we render a paused snapshot.
const demo = computed(() => {
  switch (props.product) {
    case 'agents':
      return SystemMonitorDemo
    case 'streams':
      return CollabSessionDemo
    case 'sync':
      return MultiClientPulseDemo
  }
})

// Per-product props passed through to the demo component. Streams
// trims to two columns (one human + one agent) so the snapshot
// fits comfortably alongside the section text.
const demoBindings = computed<Record<string, unknown>>(() => {
  switch (props.product) {
    case 'streams':
      return { clients: ['Alice', 'agent'] }
    default:
      return {}
  }
})
</script>

<template>
  <section
    class="home-product"
    :class="[
      `home-product--${props.product}`,
      {
        'home-product--alt': props.dark,
        'scene-first': sceneFirst,
      },
    ]"
  >
    <div class="home-product-band">
      <!-- Canvas spans the entire band — same `excludeEl` text-avoidance
           pattern the landing-page heros use. The CSS mask on
           `.home-product-bg` then fades the canvas out as it crosses
           into the text column so the geometry trails off softly under
           the headline rather than ending at a hard edge. -->
      <!-- `paused` keeps the canvas drawing the static layout and
           responding to hover/click, but suppresses the random
           ambient spawn loops. The homepage stacks three of these
           sections plus the hero composition; without pausing, the
           combined motion competes for attention with the page copy.
           Hover and click interactions still produce activity, so
           the scenes stay discoverable. -->
      <component
        :is="graphic"
        :exclude-el="textRef"
        :labels-on-hover="props.product === 'sync' || undefined"
        :paused="true"
        class="home-product-bg"
      />
      <div class="home-product-inner">
      <div class="home-product-grid">
        <!-- Foreground preview: a paused snapshot of one demo from
             the corresponding landing page, sat on top of the
             section's canvas background. Hidden on small viewports
             so the stacked text-on-canvas layout takes over. -->
        <div class="home-product-scene">
          <div class="home-product-scene-frame">
            <component
              :is="demo"
              :paused="true"
              v-bind="demoBindings"
            />
          </div>
        </div>
        <div ref="textRef" class="home-product-text">
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
/* The section has zero vertical padding so the canvas can touch the
   top and bottom of its band; vertical breathing room is then put
   back on the text column itself so headlines keep their air without
   shrinking the canvas. Horizontal padding stays on the section so
   the canvas doesn't run into the viewport edges. */
.home-product {
  position: relative;
  padding: 0 24px;
  border-bottom: 1px solid var(--vp-c-divider);
  /* Allow the canvas to bleed horizontally past the inner content
     column, but clip vertically so it can't leak into neighbouring
     sections. */
  overflow-x: clip;
  overflow-y: hidden;
}
.home-product-text {
  padding-top: 80px;
  padding-bottom: 80px;
}

.home-product--alt {
  background: var(--vp-sidebar-bg-color);
}

.home-product-band {
  position: relative;
  max-width: 100%;
  /* Critical: the canvas is `position: absolute; inset: 0` inside this
     band, so the band needs to be a positioned ancestor for it to
     fill the section rather than the viewport. */
}

.home-product-inner {
  position: relative;
  z-index: 1;
  max-width: 1152px;
  margin: 0 auto;
  /* The text column needs to receive pointer events so the buttons
     and the eyebrow are clickable, but the rest of the inner column
     should pass clicks through to the canvas (which has its own
     hover/click interactions on nodes/rails/shapes). */
  pointer-events: none;
}
.home-product-inner * {
  pointer-events: auto;
}

/* The graphic canvas is the section's full-bleed background — it
   spans the entire band. The `excludeEl` pattern keeps geometry
   from sitting under the text column at draw time, but we still
   want a softer atmospheric fade so any near-by canvas activity
   (comet tails, hover halos, ambient pulses) trails off rather
   than ending in a hard line beside the headline. We compose two
   masks: a soft top/bottom fade for the band edges, plus a
   horizontal fade towards whichever side the text column sits on. */
.home-product-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
}
/* `scene-first` puts the demo on the left, so the text column is
   on the right — fade the canvas out as it travels right. Stops
   are tuned so the canvas is already very faint by the time it
   crosses into the text column (~50%) and effectively gone by
   the time it reaches the headline. */
.home-product.scene-first .home-product-bg {
  -webkit-mask-image:
    linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%),
    linear-gradient(to right, black 28%, rgba(0, 0, 0, 0.12) 50%, transparent 70%);
  mask-image:
    linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%),
    linear-gradient(to right, black 28%, rgba(0, 0, 0, 0.12) 50%, transparent 70%);
  -webkit-mask-composite: source-in;
  mask-composite: intersect;
}
.home-product:not(.scene-first) .home-product-bg {
  -webkit-mask-image:
    linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%),
    linear-gradient(to left, black 28%, rgba(0, 0, 0, 0.12) 50%, transparent 70%);
  mask-image:
    linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%),
    linear-gradient(to left, black 28%, rgba(0, 0, 0, 0.12) 50%, transparent 70%);
  -webkit-mask-composite: source-in;
  mask-composite: intersect;
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

/* Foreground scene cell — hosts the paused demo on top of the
   section's canvas background. The cell is a flexible container
   that centres its frame; the frame itself caps the demo's
   natural width and applies a per-product transform-scale so the
   landing-page demo (sized for its full landing slot) sits
   comfortably inside the homepage column. */
.home-product-scene {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 56px 0;
  min-height: 320px;
}
.home-product-scene-frame {
  width: 100%;
  max-width: 540px;
  /* Soft drop-shadow + transform anchor so the demo card reads
     as a foreground tile sitting on top of the canvas rather
     than blending into it. */
  filter: drop-shadow(0 18px 40px rgba(0, 0, 0, 0.35));
  transform-origin: center center;
  /* The embedded demos are decorative snapshots — disable text
     selection so dragging across them doesn't highlight ticket
     numbers, agent paths, log lines, etc. */
  user-select: none;
  -webkit-user-select: none;
  cursor: default;
}
.home-product--agents .home-product-scene-frame {
  transform: scale(0.92);
}
.home-product--streams .home-product-scene-frame {
  transform: scale(0.95);
}
/* Sync's demo packs three client cards side-by-side, so it needs
   noticeably more horizontal room than the agents/streams demos
   (which are single tile and two-column respectively). */
.home-product--sync .home-product-scene-frame {
  max-width: 720px;
  transform: scale(0.82);
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

/* On mobile we drop the foreground demo entirely and let the
   section text sit directly on the canvas background. The demos
   are designed for a comfortable two-column desktop layout and
   would either overflow or scale down past readable on phones;
   the background canvas alone still carries the visual identity
   of the section. */
@media (max-width: 1099px) {
  .home-product-grid {
    grid-template-columns: 1fr !important;
    gap: 0;
  }
  .home-product:not(.scene-first) .home-product-scene,
  .home-product:not(.scene-first) .home-product-text {
    order: initial;
  }
  .home-product-scene {
    display: none;
  }
}

@media (max-width: 768px) {
  .home-product {
    padding: 0 20px;
  }
  .home-product-text {
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
    padding: 0 16px;
  }
  .home-product-text {
    padding-top: 40px;
    padding-bottom: 40px;
  }
}
</style>
