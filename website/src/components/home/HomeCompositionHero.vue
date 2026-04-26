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

import { onMounted, onBeforeUnmount, reactive, ref } from 'vue'

import HeroNetworkBg from '../agents-home/HeroNetworkBg.vue'
import StreamFlowBg from '../streams-home/StreamFlowBg.vue'
import SyncFanOutBg from '../sync-home/SyncFanOutBg.vue'

// Wrapper element so we can mutate two CSS custom properties on
// scroll: a translateY parallax offset and an additive rotateX
// "camera tilt". The actual transform composition lives in CSS so
// the static iso pose is still readable from the stylesheet.
const root = ref<HTMLDivElement>()

// Streams ref so we can call its imperative `spawnBranchAt(x, y)` to
// fire an on-streams branch animation in response to a `dotLit` from
// the agents or sync layer above/below — re-using the existing rail
// branch visual so the bridge "lands" naturally on streams.
const streamsRef = ref<{ spawnBranchAt: (x: number, y: number) => void } | null>(null)

let raf = 0
let prefersReducedMotion = false

// ── Inter-layer bridges ────────────────────────────────────────────
// When a dot lights up on the agents or sync layer, we connect it to
// the streams layer with a brief, fading dotted line. The bridge
// purely spans the Z gap (its source and target share canvas-local
// (x, y), the difference is only their plane's translateZ), so the
// implementation reduces to placing a thin div inside the .hch-stage
// 3D context and rotating it 90° around Y so its width axis ends up
// pointing along +Z (sync→streams) or -Z (agents→streams). CSS 3D
// composition then handles z-ordering and projection automatically —
// no overlay canvas, no homography math.
//
// The pool is fixed-size + reactive so we never grow/shrink the DOM:
// each spawn picks an idle slot, drives a CSS keyframe via the
// `is-active` class, and returns to the pool on `animationend`.
//
// The `spawnId` counter increments on every spawn and is folded into
// the v-for `:key` below, so each spawn forces Vue to unmount the
// old `<div>` and mount a fresh one. Without that, a tight race
// causes a slow leak: when `animationend` sets `active = false` and
// a new `dotLit` arrives in the same browser tick, `spawnBridge`
// flips `active` straight back to `true` before Vue has flushed,
// the diff sees no net change to `is-active`, the class is never
// removed-and-re-added, CSS never restarts the animation, and the
// slot is stuck `active` forever — over ~a minute the entire pool
// drains. Bumping `spawnId` makes the diff strictly different and
// guarantees a fresh element each spawn.
interface BridgeSlot {
  active: boolean
  transform: string
  spawnId: number
}

// Every `dotLit` produces a bridge if there's a free pool slot — no
// Bernoulli gate, no inter-spawn timer. A consumer or node lighting
// up *should* visibly connect to streams, otherwise the eye reads
// the missing bridge as a glitch ("why does that one not have a
// line?"). Concurrency is therefore capped only by the pool: each
// active bridge lives 800 ms, so 16 slots gives a sustained ceiling
// of 20 bridges/s, comfortably above the steady-state arrival rate
// even when a sync fan-out burst (one row → several clients) lights
// up multiple consumer dots within tens of ms of each other.
const BRIDGE_POOL_SIZE = 16

// Canvas-local → stage-local offsets. The bridges are parented in
// .hch-stage and their `translate3d(stageX, stageY, …)` is in stage
// coords, but every dotLit event arrives in the source canvas's own
// pixel space. Two CSS quirks combine to shift the canvases off the
// stage origin:
//
//   1. Each `.hch-band` has a `border: 1px` and the canvas wrapper
//      inside is `position: absolute; inset: 0` — which positions
//      against the band's *padding box*, not its border box, so the
//      wrapper's (0, 0) actually sits 1px in from each band edge.
//      This applies to all three layers (agents, streams, sync) and
//      is the reason bridges previously rendered ~1px too far left
//      on screen: at the iso tilt, a stage (-1, -1) shift projects
//      to roughly (-1.4, -0.17) screen px, which reads as a small
//      but visible left offset relative to the dot.
//
//   2. Only the agents wrapper is additionally pulled out by
//      `.hch-band--agents :deep(.hero-network-wrap) { inset: -22px }`
//      so the mesh can bleed past the layer's rounded border.
//
// So the canvas-local (0, 0) of each layer sits at stage:
//   agents : (BAND_BORDER + AGENTS_INSET, …) = (-21, -21)
//   sync   : (BAND_BORDER, BAND_BORDER)      = (  1,   1)
//   streams: (BAND_BORDER, BAND_BORDER)      = (  1,   1)
// We compose those into one offset per source for the bridge's
// stage-coord transform, and unwind the streams offset when we hand
// stage coords back to the streams canvas (which thinks in its own
// canvas-local frame) so the on-streams branch dot lands exactly on
// the bridge's terminal endpoint.
const BAND_BORDER_PX = 1
const AGENTS_CANVAS_INSET_PX = -22

const bridgeSlots = reactive<BridgeSlot[]>(
  Array.from({ length: BRIDGE_POOL_SIZE }, () => ({
    active: false,
    transform: '',
    spawnId: 0,
  })),
)

function spawnBridge(source: 'agents' | 'sync', x: number, y: number) {
  if (prefersReducedMotion) return
  const slot = bridgeSlots.find((s) => !s.active)
  if (!slot) return
  // Translate the canvas-local (x, y) into the .hch-stage frame the
  // bridges live in. See the BAND_BORDER_PX / AGENTS_CANVAS_INSET_PX
  // comment above for why the offsets aren't simply 0 (sync) and
  // -22 (agents).
  const offset =
    BAND_BORDER_PX + (source === 'agents' ? AGENTS_CANVAS_INSET_PX : 0)
  const stageX = x + offset
  const stageY = y + offset
  // Source plane Z + rotation direction so the rotated strip extends
  // from the source plane *toward* streams. CSS rotateY(+90deg) sends
  // a strip's +X width axis onto -Z, and rotateY(-90deg) onto +Z, so:
  //   agents (Z=+160) → streams (Z=+40): need -Z → rotateY(+90)
  //   sync   (Z=-80)  → streams (Z=+40): need +Z → rotateY(-90)
  // The concrete Z values come from CSS custom properties on
  // .hch-stage so the two responsive breakpoints (intermediate /
  // mobile) override them without touching this code path.
  const zVar =
    source === 'agents' ? 'var(--hch-z-agents)' : 'var(--hch-z-sync)'
  const rotY = source === 'agents' ? 90 : -90
  slot.transform = `translate3d(${stageX.toFixed(2)}px, ${stageY.toFixed(2)}px, ${zVar}) rotateY(${rotY}deg)`
  // Bumping `spawnId` flips the v-for `:key` so Vue mounts a fresh
  // <div> on every spawn — see the comment on `BridgeSlot` for why
  // a plain class toggle leaks slots over time.
  slot.spawnId++
  slot.active = true
  // Fire the matching on-streams branch so the bridge visually "lands"
  // on the streams layer with the same little ring + pulse the rest
  // of the rail fan-outs use. The streams canvas thinks in its own
  // canvas-local frame, which is shifted by BAND_BORDER_PX from the
  // stage frame for the same reason agents/sync are — so unwind that
  // offset here, otherwise the branch dot lands 1px down-right of
  // the bridge endpoint and reads as a small "split tip".
  streamsRef.value?.spawnBranchAt(
    stageX - BAND_BORDER_PX,
    stageY - BAND_BORDER_PX,
  )
}

function onAgentsDotLit(x: number, y: number) {
  spawnBridge('agents', x, y)
}
function onSyncDotLit(x: number, y: number) {
  spawnBridge('sync', x, y)
}
function onBridgeAnimationEnd(slot: BridgeSlot) {
  slot.active = false
}

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
          :spawn-rate="0.15"
          :die-rate="0.15"
          :emit-dot-lit="true"
          @dot-lit="onSyncDotLit"
        />
        <span class="hch-band-label">sync</span>
      </div>
      <div class="hch-band hch-band--streams">
        <StreamFlowBg ref="streamsRef" :no-edge-fade="true" />
        <span class="hch-band-label">streams</span>
      </div>
      <div class="hch-band hch-band--agents">
        <HeroNetworkBg
          :no-edge-fade="true"
          :spawn-rate="0.4"
          :die-rate="0.4"
          :reposition-on-spawn="true"
          :emit-dot-lit="true"
          @dot-lit="onAgentsDotLit"
        />
        <span class="hch-band-label">agents</span>
      </div>
      <!-- Bridge pool: thin dotted strips parented inside the 3D
           stage so they inherit the iso transform. Each slot is
           pre-rendered once and reused — `is-active` triggers the
           CSS keyframe animation, `animationend` returns the slot
           to the pool. The transform is set per-spawn to anchor at
           the source dot's (x, y) on the source plane and rotate
           90° around Y so the strip extends toward streams. -->
      <div
        v-for="(slot, i) in bridgeSlots"
        :key="`bridge-${i}-${slot.spawnId}`"
        class="hch-bridge"
        :class="{ 'is-active': slot.active }"
        :style="{ transform: slot.transform }"
        @animationend="onBridgeAnimationEnd(slot)"
      />
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
  /* Per-band Z offsets exposed as custom properties so the bridge
     pool below can read the same values via `var(--hch-z-…)` in its
     inline transforms — keeping the bridge endpoints exactly on the
     source/target planes across responsive breakpoints (px on
     desktop, vw on mobile). `--hch-bridge-len` is the |Z| span from
     each side layer to streams, which is symmetric at every
     breakpoint, so the bridge strip's width can be a single var. */
  --hch-z-agents: 160px;
  --hch-z-streams: 40px;
  --hch-z-sync: -80px;
  --hch-bridge-len: 120px;
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
.hch-band--agents   { transform: translateZ(var(--hch-z-agents)); }
.hch-band--streams  { transform: translateZ(var(--hch-z-streams)); }
.hch-band--sync     { transform: translateZ(var(--hch-z-sync)); }

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

/* ── Inter-layer bridge strips ────────────────────────────────────
   A pool of identical thin dotted strips parented inside .hch-stage
   so they live in the same 3D context as the layer bands. Each
   strip is laid out flat at the stage origin (top-left, 1px tall)
   and rotated/translated per-spawn into position. Because the
   bridge always spans purely along Z (source and target share
   canvas-local x, y), a single rotateY(±90°) is enough — no
   homography or per-axis maths.

   Layout:
   - `width: var(--hch-bridge-len)` matches the |Z| span between the
     side layer (agents or sync) and streams, so the strip's right
     edge lands exactly on the streams plane after rotation.
   - `transform-origin: 0 50% 0` pivots at the strip's left-middle:
     the inline transform translates that pivot to (x, y, Z_source)
     and then rotateY(±90°) swings the strip's width axis from +X
     onto ±Z so it points at streams.
   - `repeating-linear-gradient` paints a 1px-on / 3px-off dotted
     pattern in the brand teal — same colour family as the streams
     branch fan-outs so the bridge reads as part of that visual
     vocabulary, not a separate effect. */
.hch-bridge {
  position: absolute;
  top: 0;
  left: 0;
  width: var(--hch-bridge-len);
  height: 1px;
  pointer-events: none;
  transform-origin: 0 50% 0;
  background:
    repeating-linear-gradient(
      to right,
      var(--vp-c-brand-1) 0 1px,
      transparent 1px 4px
    );
  opacity: 0;
  /* Keep the strip composited on its own layer so the per-spawn
     transform updates don't trigger layout in the rest of the
     stage. */
  will-change: opacity, transform;
}

/* `is-active` runs the full lifecycle — fade in, hold, fade out —
   in 800ms. The hold opacity (0.55) is intentionally a little
   lower than the streams branch peak (~0.7) so the bridge reads
   as the connecting "hint" and the on-streams branch / pulse
   reads as the resolved event. `forwards` keeps the closing
   keyframe's opacity:0 in place so the strip stays invisible
   until the next spawn re-toggles `is-active`. */
.hch-bridge.is-active {
  animation: hch-bridge-life 800ms ease-in-out forwards;
}

@keyframes hch-bridge-life {
  0%   { opacity: 0; }
  18%  { opacity: 0.55; }
  78%  { opacity: 0.55; }
  100% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .hch-bridge,
  .hch-bridge.is-active {
    animation: none;
    opacity: 0;
  }
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
    /* Tighter Z spread for the side-by-side hero column so the
       stack reads as a compact model, not an oversized one. The
       sync↔streams and agents↔streams gaps stay symmetric, so a
       single bridge length still works. */
    --hch-z-agents: 120px;
    --hch-z-streams: 30px;
    --hch-z-sync: -60px;
    --hch-bridge-len: 90px;
  }
}

/* Mobile (≤860): the homepage hero renders the iso scene larger than
   the viewport (140vw × 140vw) and bleeds 100vw of it off the top of
   the screen, leaving only a ~40vw-tall strip of the scene visible at
   the top of the hero — see `HomeHero.vue` for the full bleed math.
   Two important consequences for the iso composition:

   1. The visible window is short (~40vw) and wide (~100vw). We
      `align-items: flex-end` so the stage anchors to the scene's
      bottom edge — putting the stage (and its bands) inside the
      visible strip rather than in the bled-off upper region — and
      the stage is sized to roughly fit that 40vw vertical budget.
   2. The Z-spread that gives the stack its layered depth has to be
      tightened correspondingly: with the large desktop spread the
      `+Z` agents/streams bands would project upward off the top of
      the visible strip and disappear into the bled region. The vw
      units keep what remains scaling proportionally with viewport
      width across phones and small tablets. */
@media (max-width: 860px) {
  .hch {
    /* No padding-top — `align-items: flex-end` below positions the
       stage at the bottom of the scene, inside the visible strip. */
    padding-top: 0;
    align-items: flex-end;
  }
  .hch-stage {
    /* Width intentionally inherits from the base rule (64% of the
       .hch wrapper). With the wrapper at 140vw × 140vw on mobile,
       that gives a ~90vw-wide stage — large enough that the iso
       composition reads as the visual anchor of the page rather
       than a small icon, with most of the labelled bands landing
       inside the visible strip after the upward bleed crops the
       top of the scene.

       The slightly steeper rotateX (66° vs the base's 64°) flattens
       the iso a touch so the bands' vertical footprint is more
       compact — useful when the visible strip itself is short. */
    transform:
      translateY(var(--hch-shift-y, 0px))
      rotateX(66deg)
      rotateZ(-30deg);
    /* Z-spread expressed in vw so the separation scales with viewport
       width. Sync sits well below the page (-12vw) so its protruding
       bottom-front edge anchors the stack visually inside the cropped
       strip; agents stays high (+6vw) so its front face is the
       dominant top plane; streams is placed at the geometric midpoint
       between the two ((-12 + 6) / 2 = -3vw) so the three bands read
       as evenly stratified rather than top- or bottom-heavy. The
       bridge length is the symmetric |Z| gap (9vw) so the dotted
       strip terminates exactly on the streams plane on phones too. */
    --hch-z-agents: 6vw;
    --hch-z-streams: -3vw;
    --hch-z-sync: -12vw;
    --hch-bridge-len: 9vw;
  }
}
</style>
