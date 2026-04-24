<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
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
  /** Side the iso scene sits on. Text takes the other side. */
  sceneSide: 'left' | 'right'
}

const COPY: Record<Product, Copy> = {
  agents: {
    eyebrow: 'Agent runtime',
    name: 'Electric Agents',
    title: 'The runtime for long-lived&nbsp;agents',
    sub: 'Agents live as durable, synced entities — resumable across devices, observable across teams, forkable for review and experimentation.',
    cta: { text: 'Explore Agents', href: '/agents' },
    sceneSide: 'left',
  },
  streams: {
    eyebrow: 'Data primitive',
    name: 'Electric Streams',
    title: 'The data primitive for the agent&nbsp;loop',
    sub: 'Persistent, addressable, real-time streams — a&nbsp;flexible, swiss-army-knife data primitive for agent session data.',
    cta: { text: 'Explore Streams', href: '/streams' },
    sceneSide: 'right',
  },
  sync: {
    eyebrow: 'Sync engine',
    name: 'Electric Sync',
    title: 'The core sync engine&nbsp;technology',
    sub: 'Composable sync primitives that power end-to-end reactivity and collaboration for multi-agent systems.',
    cta: { text: 'Explore Sync', href: '/sync' },
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

// Track whether we have desktop width available for the streams
// snapshot. On wide viewports the scene column comfortably fits all
// three CollabSession panes (Alice + agent + Bob); below that the
// 5fr scene column starts squeezing the panes and the section's own
// 2-col / stacked transitions kick in, so we trim to two panes
// (one human + one agent) so the snapshot reads cleanly.
//
// 1100px matches the section's `@media (max-width: 1099px)` tablet
// breakpoint — above it we're in the desktop layout where the demo
// renders at its full 0.95 desktop scale and has the room to show
// all three clients.
//
// SSR-safe: default to true so the initial server-rendered markup
// matches the most common (desktop) case; we re-evaluate on mount
// and on every media-query change.
const isStreamsDesktop = ref(true)

let streamsMql: MediaQueryList | null = null
function syncStreamsMql() {
  if (streamsMql) isStreamsDesktop.value = streamsMql.matches
}

onMounted(() => {
  if (typeof window === 'undefined' || !window.matchMedia) return
  streamsMql = window.matchMedia('(min-width: 1100px)')
  syncStreamsMql()
  streamsMql.addEventListener('change', syncStreamsMql)
})

onBeforeUnmount(() => {
  if (streamsMql) {
    streamsMql.removeEventListener('change', syncStreamsMql)
    streamsMql = null
  }
})

// Per-product props passed through to the demo component.
const demoBindings = computed<Record<string, unknown>>(() => {
  switch (props.product) {
    case 'streams':
      return {
        clients: isStreamsDesktop.value
          ? ['Alice', 'agent', 'Bob']
          : ['Alice', 'agent'],
      }
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
        <!-- Foreground preview: one demo from the corresponding
             landing page, sat on top of the section's canvas
             background. Each demo already wires up its own
             `useDemoVisibility` intersection observer and only
             starts its animation loop when scrolled into view (and
             pauses again when scrolled away), so we don't need any
             explicit start/stop here — passing `:paused="false"`
             just opts out of the static-snapshot mode the demos
             also support and lets that built-in
             scroll-into-view trigger run.

             We leave the background canvas (above) paused: the
             homepage stacks three of these sections plus the hero
             composition, and three live canvases plus three live
             demos plus the hero would compete with the page copy
             for attention. The framed demo is the call-to-look. -->
        <div class="home-product-scene">
          <div class="home-product-scene-frame">
            <component
              :is="demo"
              :paused="false"
              v-bind="demoBindings"
            />
          </div>
        </div>
        <div ref="textRef" class="home-product-text">
          <p class="home-product-eyebrow">{{ copy.eyebrow }}</p>
          <p class="home-product-name">{{ copy.name }}</p>
          <h2 class="home-product-title" v-html="copy.title" />
          <p class="home-product-sub" v-html="copy.sub" />
          <div class="home-product-actions">
            <VPButton
              tag="a"
              size="medium"
              theme="brand"
              :text="copy.cta.text"
              :href="copy.cta.href"
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
  /* All scaling goes through this CSS variable so per-product
     baselines (set below) and per-breakpoint shrinks (mobile rules
     near the bottom of this stylesheet) compose cleanly through
     the cascade — set the variable, never the `transform`. The
     per-product selectors below set the desktop baseline; mobile
     @media blocks override `--demo-scale` in scale steps. */
  --demo-scale: 1;
  transform: scale(var(--demo-scale));
  /* The embedded demos are decorative snapshots — disable text
     selection so dragging across them doesn't highlight ticket
     numbers, agent paths, log lines, etc. */
  user-select: none;
  -webkit-user-select: none;
  cursor: default;
}
/* Per-product desktop baseline scales. Each landing-page demo is
   sized for its full landing slot, so we shrink them slightly to
   sit comfortably inside the homepage column. Sync also gets more
   horizontal room because its demo packs three client cards
   side-by-side. */
.home-product--agents .home-product-scene-frame {
  --demo-scale: 0.92;
}
.home-product--streams .home-product-scene-frame {
  --demo-scale: 0.95;
  /* Wider than the default 540px so three CollabSession panes
     (Alice + agent + Bob) have enough horizontal room for their
     message text. The two-pane fallback below 1100px reverts to
     the standard frame width via the tablet/mobile rules. */
  max-width: 640px;
}
.home-product--sync .home-product-scene-frame {
  --demo-scale: 0.82;
  max-width: 720px;
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
  font-weight: 600;
  line-height: 1.05;
  letter-spacing: -0.02em;
  color: var(--ea-text-1);
  margin: 0 0 12px;
}

.home-product-title {
  font-size: 28px;
  font-weight: 600;
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

/* Tablet (768–1099px) keeps the desktop side-by-side composition —
   the demos are sized for ~540–720px wide slots and read just fine
   in that range. We only switch to stacked at proper phone widths.

   We flip the grid ratio so the **text** column gets the bigger
   share at this width — the headline and supporting copy need
   reading room before the demo does — and shrink the demos a
   touch further so they sit comfortably in their now-narrower
   slot. The base grid is `scene-fr  text-fr`; the
   `:not(.scene-first)` variant flips column order via `order` and
   flips the columns to `text-fr  scene-fr`, so to put the
   *text* on the bigger track in both layouts we need to write
   `5fr 7fr` for `scene-first` (col 1 = scene, col 2 = text) and
   `7fr 5fr` for `:not(.scene-first)` (col 1 = text, col 2 = scene). */
@media (max-width: 1099px) and (min-width: 768px) {
  /* `minmax(0, Nfr)` (not bare `Nfr`) is critical here: bare `fr`
     resolves to `minmax(auto, Nfr)`, which lets each track grow
     past its share if its content's min-content width demands it.
     The agents demo (`SystemMonitorDemo`) has no narrow layout
     until <480px so its desktop min-content easily exceeds a
     5fr share at tablet widths and silently steals room from the
     7fr text track — visually the text column never gets wider.
     `minmax(0, ...)` forces the tracks to honour the ratio. */
  .home-product-grid {
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
    gap: 32px;
  }
  .home-product:not(.scene-first) .home-product-grid {
    grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
  }
  /* And take the demos down further at this width — once the
     scene column is properly capped at 5fr, the demo needs to
     visually settle into a noticeably smaller footprint than
     the desktop version or it still feels chunky beside the
     widened text column. */
  .home-product--agents .home-product-scene-frame {
    --demo-scale: 0.7;
    max-width: 420px;
  }
  .home-product--streams .home-product-scene-frame {
    --demo-scale: 0.74;
    max-width: 420px;
  }
  .home-product--sync .home-product-scene-frame {
    --demo-scale: 0.6;
    max-width: 540px;
  }
}

/* Phone widths (<768px) — stack the scene on top with the text
   beneath. Important: we deliberately do NOT reset
   `--demo-scale: 1` and `max-width: 100%` here.

   The earlier "let the demo fill the column at scale 1" approach
   produced a noticeable jump because each demo's own narrow
   layout kicks in at a different breakpoint:
     - agents (`SystemMonitorDemo`) stays in its full desktop
       layout down to 480px;
     - streams (`CollabSessionDemo`) goes narrow at 960px;
     - sync (`MultiClientPulseDemo`) goes 2-col at 760px.
   So between ~480px and 767px, agents in particular runs at
   full desktop layout AT full column width AT 100% scale —
   visually huge. Instead we keep a controlled max-width and
   carry the tablet shrink through this range so the transition
   from side-by-side → stacked is a continuous size-down rather
   than a sudden upscaling. */
@media (max-width: 767px) {
  .home-product-grid {
    grid-template-columns: 1fr !important;
    gap: 0;
  }
  /* Force the scene above the text regardless of which side it
     sits on at desktop — the in-section preview should always lead. */
  .home-product-scene {
    order: 0 !important;
    padding: 32px 0 4px;
    min-height: 0;
  }
  .home-product-text {
    order: 1 !important;
    padding-top: 16px;
    padding-bottom: 56px;
  }
  .home-product {
    padding: 0 20px;
  }
  .home-product--agents .home-product-scene-frame {
    --demo-scale: 0.78;
    max-width: 460px;
  }
  .home-product--streams .home-product-scene-frame {
    --demo-scale: 0.82;
    max-width: 460px;
  }
  .home-product--sync .home-product-scene-frame {
    --demo-scale: 0.7;
    max-width: 560px;
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

/* At <480px each demo's own narrow layout has kicked in (or is
   about to), so we relax the max-width cap to let them use the
   full column, and reset --demo-scale to 1 so the now-natively
   narrow demo isn't double-shrunk. The progressive 430/375/340
   steps below then bring everything down a notch at the smallest
   sizes. */
@media (max-width: 480px) {
  .home-product {
    padding: 0 16px;
  }
  .home-product-text {
    padding-top: 12px;
    padding-bottom: 40px;
  }
  .home-product-scene {
    padding: 24px 0 0;
  }
  .home-product--agents .home-product-scene-frame,
  .home-product--streams .home-product-scene-frame,
  .home-product--sync .home-product-scene-frame {
    --demo-scale: 1;
    max-width: 100%;
  }
}

/* On phones the demos still feel chunky relative to the surrounding
   type — drop `--demo-scale` in three steps as the viewport narrows
   below 430px. We deliberately do NOT use a negative margin-bottom
   to compensate for the unused vertical space: CSS `%` margins are
   width-relative, not height-relative, so they over-pull at narrow
   widths and end up cropping demos with a tall natural height (e.g.
   the streams pane). A small extra gap beneath the scaled demo is
   fine — we trim the scene's bottom padding instead. Sync gets a
   sharper drop at each step because its 2-column "Web/Mobile +
   Agent" layout is taller than the agents/streams snapshots. */
@media (max-width: 430px) {
  .home-product-scene {
    padding-bottom: 0;
  }
  .home-product--agents .home-product-scene-frame {
    --demo-scale: 0.85;
  }
  .home-product--streams .home-product-scene-frame {
    --demo-scale: 0.85;
  }
  .home-product--sync .home-product-scene-frame {
    --demo-scale: 0.78;
  }
}

@media (max-width: 375px) {
  .home-product--agents .home-product-scene-frame {
    --demo-scale: 0.78;
  }
  .home-product--streams .home-product-scene-frame {
    --demo-scale: 0.78;
  }
  .home-product--sync .home-product-scene-frame {
    --demo-scale: 0.68;
  }
}

@media (max-width: 340px) {
  .home-product--agents .home-product-scene-frame {
    --demo-scale: 0.7;
  }
  .home-product--streams .home-product-scene-frame {
    --demo-scale: 0.7;
  }
  .home-product--sync .home-product-scene-frame {
    --demo-scale: 0.6;
  }
}
</style>
