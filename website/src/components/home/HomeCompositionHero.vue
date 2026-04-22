<script setup lang="ts">
/* Hero: Composition Stack
 *
 * Three isometric 3D layers — Sync at the base, Streams in the
 * middle, Agents on top — each one a tightly framed instance of
 * the canvas hero background that powers its corresponding
 * landing page. Reusing the canvases verbatim guarantees the
 * line weight, fades, comet tails and hover behaviour are
 * identical to the heros of `/agents`, `/streams`, and `/sync`.
 *
 * The visual story is "the platform composes": the same drawing
 * primitives sit on three stacked planes that visibly extend
 * out from beneath each other in isometric projection, so the
 * eye reads the stack as a literal layered architecture.
 *
 * Each layer is a flat plane offset along the Z axis inside a
 * `transform-style: preserve-3d` stage that's tilted with
 * `rotateX(...) rotateZ(...)` — the classic CSS isometric trick.
 * The layer backgrounds are slightly translucent so a hint of
 * the layer beneath shows through where they overlap, while the
 * isometric projection naturally exposes the bottom-front edge
 * of each lower layer beyond the footprint of the layer above.
 */

import { onMounted, onBeforeUnmount, ref } from 'vue'

import HeroNetworkBg from '../agents-home/HeroNetworkBg.vue'
import StreamFlowBg from '../streams-home/StreamFlowBg.vue'
import SyncFanOutBg from '../sync-home/SyncFanOutBg.vue'

// Wrapper element so we can mutate two CSS custom properties on
// scroll: a translateY parallax offset and an additive rotateX
// "camera tilt". The actual transform composition lives in CSS so
// the static iso pose is still readable from the stylesheet.
const root = ref<HTMLDivElement>()

// Per-layer label refs are forwarded to each canvas Bg as `excludeEl`
// so the underlying text-avoidance logic (already used to keep the
// landing-page hero meshes from overlapping the headline copy) also
// keeps each iso layer's "sync" / "streams" / "agents" sticker clear
// of nodes, rails, and dots.
const syncLabelRef = ref<HTMLSpanElement>()
const streamsLabelRef = ref<HTMLSpanElement>()
const agentsLabelRef = ref<HTMLSpanElement>()

let raf = 0
let prefersReducedMotion = false

function onScroll() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    if (!root.value || prefersReducedMotion) return
    // Very subtle parallax: ease the scene a few pixels upward
    // over the first ~500px of scroll, then hold. Starting at
    // 0 (no shift) means the iso scene sits exactly where the
    // SSR layout puts it, so there is no "jump" or "shoots up
    // the page" feel — the camera just drifts a hair as you
    // start reading, then settles. Max shift is intentionally
    // tiny (~24px) so it reads as parallax breathing rather
    // than motion you have to track.
    const y = Math.max(0, window.scrollY)
    const progress = Math.min(1, y / 500)
    const shift = -progress * 24
    root.value.style.setProperty('--hch-shift-y', `${shift}px`)
  })
}

onMounted(() => {
  if (typeof window === 'undefined') return
  prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches
  if (prefersReducedMotion) return
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onBeforeUnmount(() => {
  if (typeof window === 'undefined') return
  window.removeEventListener('scroll', onScroll)
  if (raf) cancelAnimationFrame(raf)
})
</script>

<template>
  <div
    ref="root"
    class="hch"
    aria-label="Electric platform composition: agents on top of streams on top of sync"
  >
    <div class="hch-stage">
      <!-- Bottom layer: sync. Drawn first so DOM order matches
           painter's order; the 3D translateZ decides what's
           actually in front, but keeping DOM order aligned with
           depth helps deterministic stacking when planes overlap
           exactly. -->
      <div class="hch-band hch-band--sync">
        <SyncFanOutBg
          :labels-on-hover="true"
          :no-edge-fade="true"
          :exclude-el="syncLabelRef"
        />
        <span ref="syncLabelRef" class="hch-band-label">sync</span>
      </div>
      <div class="hch-band hch-band--streams">
        <StreamFlowBg :no-edge-fade="true" :exclude-el="streamsLabelRef" />
        <span ref="streamsLabelRef" class="hch-band-label">streams</span>
      </div>
      <div class="hch-band hch-band--agents">
        <HeroNetworkBg :no-edge-fade="true" :exclude-el="agentsLabelRef" />
        <span ref="agentsLabelRef" class="hch-band-label">agents</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The 3D viewport. Perspective is set quite high (≈ orthographic)
   so the three layers don't dramatically foreshorten — the look
   is closer to a true isometric architectural diagram than a
   first-person perspective render. */
.hch {
  position: absolute;
  inset: 0;
  /* A gentle perspective. True orthographic projection (no
     perspective at all) makes each layer the same projected
     size, which read as flat and disconnected. A high
     perspective value still keeps the iso character — parallel
     edges look essentially parallel — while the slight depth
     foreshortening anchors the stack as a coherent 3D object. */
  perspective: 2400px;
  perspective-origin: 50% 55%;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Nudge the whole stack down so its visual centre lines up
     with the headline copy. The widened Z spread (sync goes well
     below 0, agents stays high) shifts the stack's centroid
     upward, so we use a smaller padding-top here than the layer
     offsets alone would suggest in order to keep the agents
     plane anchored at the same screen height. */
  padding-top: 6%;
  /* Pointer events propagate to children so hover on each layer
     still wakes its canvas; the wrapper itself is a passive
     viewport. */
  pointer-events: none;
}

/* The stage holds the three layers in shared 3D space. The tilt
   here is the only place the isometric angle is set — every
   layer inherits it via `transform-style: preserve-3d`. The
   classic 30°/30° iso uses rotateX(60) rotateZ(-30); a slightly
   shallower X tilt reads as "looking down at a stack" rather
   than "floor plan". */
.hch-stage {
  position: relative;
  /* Square plane: matches the visual rhythm of an architectural
     stack diagram and avoids the slightly awkward landscape
     parallelogram that a wider plane produces under iso tilt. */
  width: 64%;
  aspect-ratio: 1 / 1;
  height: auto;
  transform-style: preserve-3d;
  /* `--hch-shift-y` is updated on scroll for a subtle parallax
     drift (defaults to 0 so SSR / no-JS / reduced-motion users
     see the static iso pose). The translateY happens *before*
     the rotates so it shifts the scene in screen space rather
     than along the layer's local Z axis. The base rotateX is
     tuned to feel like the camera is looking comfortably down
     onto the stack — steep enough that you read each layer's
     surface clearly, gentle enough that the protruding edges
     still extend out and read as separate planes. */
  transform:
    translateY(var(--hch-shift-y, 0px))
    rotateX(64deg)
    rotateZ(-32deg);
  transform-origin: center center;
  /* Smooth out micro-jitter from the rAF-throttled scroll
     handler without making the motion feel laggy. */
  transition: transform 60ms linear;
  will-change: transform;
}

/* Each band is a flat plane sized to the stage. The translateZ
   offsets push them apart along the (tilted) Z axis, which in
   the rotated view projects roughly as "up and slightly to the
   right" on screen — exposing the bottom-front edge of each
   layer below. */
.hch-band {
  position: absolute;
  inset: 0;
  /* Translucent surface so a hint of the layer beneath bleeds
     through where they overlap. We use the VitePress sidebar
     background colour as the base — it's the canonical "panel"
     surface in the theme on both light and dark, so the iso
     planes pick up the same elevated-card tint that the rest of
     the chrome uses. The 92% alpha keeps a touch of show-through
     between layers. */
  background: color-mix(in srgb, var(--vp-sidebar-bg-color) 92%, transparent);
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 22%, var(--vp-c-divider));
  border-radius: 14px;
  overflow: hidden;
  /* Soft drop shadow for depth — strongest on the topmost layer
     where each layer is overridden below. */
  box-shadow:
    0 18px 40px -10px rgba(0, 0, 0, 0.45),
    0 6px 14px -6px rgba(0, 0, 0, 0.3);
  /* The iso composition is a static visual — no hover/click
     interactions on nodes, rails or shapes. Disabling pointer
     events here also lets selection/scroll on the surrounding
     hero copy pass straight through, which is the right default
     for a decorative scene. */
  pointer-events: none;
  /* Each band is its own 3D context so the canvas + label inside
     don't fall back to flat compositing while the parent does
     the heavy 3D lifting. */
  transform-style: preserve-3d;
  backface-visibility: hidden;
}

/* Stack offsets. Agents sits at the highest point and is the
   anchor — its translateZ is held constant; streams and sync are
   pushed progressively further beneath it so the lower edge of
   the stack overflows the hero band and bleeds into the start of
   the next section. The wider spread also makes the three layers
   feel like distinctly separate strata of a system rather than a
   tightly compressed sandwich. */
.hch-band--agents   { transform: translateZ(160px); }
.hch-band--streams  { transform: translateZ(40px); }
.hch-band--sync     { transform: translateZ(-80px); }

/* Subtle layer-tint accent: a brand-coloured wash on each layer's
   border helps you parse the three planes as distinct strata
   even before you read the labels. */
.hch-band--sync {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 14%, var(--vp-c-divider));
  box-shadow:
    0 12px 32px -10px rgba(0, 0, 0, 0.38),
    0 4px 10px -4px rgba(0, 0, 0, 0.25);
}
.hch-band--streams {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 22%, var(--vp-c-divider));
}
.hch-band--agents {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 32%, var(--vp-c-divider));
  box-shadow:
    0 28px 60px -12px rgba(0, 0, 0, 0.55),
    0 10px 22px -8px rgba(0, 0, 0, 0.35);
}

/* Let the agents network mesh bleed slightly past the agents
   layer's edges and get clipped by the card border, so a few
   nodes/edges feel like they're escaping out beyond the
   bounds. The streams (rails) and sync (grid) motifs already
   have natural edge alignment so we leave them alone — only
   the agents mesh, with its triangulated organic shape, reads
   better when it isn't perfectly contained inside the frame.
   `:deep(.hero-network-wrap)` reaches into the scoped child
   and replaces its default `inset: 0` with a negative inset,
   which makes the canvas slightly larger than the band; the
   band's own `overflow: hidden` then crops the overflow at
   the rounded border. */
.hch-band--agents :deep(.hero-network-wrap) {
  inset: -22px;
}

/* The reused canvas Bg components each set
   `pointer-events: auto` on their <canvas> so they can wire up
   hover/click on the landing pages. In the iso hero, those
   interactions don't make sense — the 3D transform breaks the
   canvas's screen-space → logical-space hit testing — so we
   override pointer events back to `none` on every canvas inside
   the stack. The cursor passes straight through to the page. */
.hch :deep(canvas) {
  pointer-events: none;
}

/* Tiny mono band label, bottom-left of each band. The bottom-
   left is the front-most corner of every plane in our iso
   projection (rotateX(58) rotateZ(-32) tilts the +Y/+X corner
   toward the viewer), so anchoring labels there puts them on the
   protruding leading edge of each layer where they read most
   prominently and never get occluded by a higher layer. The
   label tilts with its plane in 3D, so it reads as a sticker on
   the card rather than a screen-aligned overlay. */
.hch-band-label {
  position: absolute;
  bottom: 10px;
  left: 14px;
  z-index: 2;
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  /* Brand cyan in dark mode, brand indigo in light — the iso layers are
     the visual key for the three products, so the labels stay highlighted
     in the brand colour at all times rather than only on hover. */
  color: var(--vp-c-brand-1);
  opacity: 0.95;
  transition: opacity 0.2s ease;
  pointer-events: none;
  user-select: none;
}
.hch-band:hover .hch-band-label {
  opacity: 1;
}

/* Intermediate widths (still side-by-side with the text). The cell
   narrows so trim the iso plane down a notch and tighten the Z spread
   so it reads as a compact stack rather than an oversized model. */
@media (max-width: 1099px) and (min-width: 861px) {
  .hch {
    padding-top: 4%;
  }
  .hch-stage {
    width: 64%;
    transform:
      translateY(var(--hch-shift-y, 0px))
      rotateX(62deg)
      rotateZ(-30deg);
  }
  .hch-band--agents  { transform: translateZ(120px); }
  .hch-band--streams { transform: translateZ(30px); }
  .hch-band--sync    { transform: translateZ(-60px); }
}

/* Below 861px the homepage hero hides the iso scene entirely (see
   `HomeHero.vue`), so no further breakpoints are needed here — the
   composition only renders at side-by-side widths. */
</style>
