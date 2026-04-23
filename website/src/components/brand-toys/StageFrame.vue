<script setup lang="ts">
/* StageFrame — the resizable recording area.
   ────────────────────────────────────────────
   Wraps a toy in a centred, dimension-locked frame that:
   - Accepts v-model:width / v-model:height numeric CSS px.
   - Exposes CSS `resize: both` on the frame so you can drag to
     resize; a ResizeObserver syncs the drag back into v-model.
   - Applies a preset stage background tint for legibility.
   - Shows optional per-px rulers along the frame edges.
   - Shows a discreet dimension badge in the bottom-right corner.

   Everything else (size presets, bg presets, control toggles) is
   owned by the parent `BrandToysToy.vue` via its `ControlPanel`. */

import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue"

const props = defineProps<{
  width: number
  height: number
  /** CSS px of breathing room around the stage frame inside the shell. */
  padding?: number
  background?:
    | "dark"
    | "surface"
    | "elv"
    | "light"
    | "transparent"
    | "black"
    | "white"
  showRuler?: boolean
  showBorder?: boolean
  fullBleed?: boolean
}>()

const emit = defineEmits<{
  (e: "update:width", value: number): void
  (e: "update:height", value: number): void
}>()

const frameRef = ref<HTMLElement>()

// Resize sync — when the user drags the CSS `resize` handle, keep the
// numeric width/height in v-model so the control panel reflects it in
// real time.
let observer: ResizeObserver | null = null
let suppressObserver = false

function updateFromFrame() {
  const el = frameRef.value
  if (!el) return
  const w = Math.round(el.getBoundingClientRect().width)
  const h = Math.round(el.getBoundingClientRect().height)
  // Guard against transient zero readings (e.g. when an ancestor is briefly
  // unmounted by HMR, or before the element has been laid out). Without
  // this we'd silently overwrite the user's stage size with `0×0`.
  if (w === 0 || h === 0) return
  if (w !== props.width) emit("update:width", w)
  if (h !== props.height) emit("update:height", h)
}

onMounted(() => {
  observer = new ResizeObserver(() => {
    // Skip the echo when we're the ones who just updated the size via
    // inline style (avoids a tiny px-rounding loop between the numeric
    // input and the observer).
    if (suppressObserver) {
      suppressObserver = false
      return
    }
    updateFromFrame()
  })
  if (frameRef.value) observer.observe(frameRef.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
})

// When props change externally (numeric input, preset dropdown), the
// inline style drives the frame; the observer will fire but we want to
// ignore that echo.
watch(
  () => [props.width, props.height],
  () => {
    suppressObserver = true
  }
)

const frameStyle = computed(() => ({
  width: `${props.width}px`,
  height: `${props.height}px`,
}))

// Padding is INSET inside the frame as a "safe area". The frame
// stays exactly `width × height` (so the recording lines up with the
// chosen preset). Rather than apply CSS padding and hope the toy
// respects it (some components use `position: absolute; inset: 0`
// or otherwise ignore parent padding), we mount the toy inside an
// explicitly-sized inner div that is already
// `(width − 2·padding) × (height − 2·padding)`, positioned at the
// padding offset. The toy sees a fully-sized parent and just fills
// it — no per-component changes needed.
const contentStyle = computed(() => {
  const p = props.padding ?? 30
  // Clamp so massive padding can't produce a negative-size box. We
  // bottom out at 0 (component collapses) rather than going
  // negative, which would explode layout.
  const w = Math.max(0, props.width - p * 2)
  const h = Math.max(0, props.height - p * 2)
  return {
    top: `${p}px`,
    left: `${p}px`,
    width: `${w}px`,
    height: `${h}px`,
  }
})

const bgClass = computed(() => `bg-${props.background ?? "dark"}`)

const dimBadge = computed(() => `${props.width} × ${props.height}`)

// Ruler ticks — major every 100px, minor every 10px. Rendered only
// when `showRuler` is on.
const horizTicks = computed(() => {
  const out: { x: number; major: boolean }[] = []
  for (let x = 0; x <= props.width; x += 10) {
    out.push({ x, major: x % 100 === 0 })
  }
  return out
})
const vertTicks = computed(() => {
  const out: { y: number; major: boolean }[] = []
  for (let y = 0; y <= props.height; y += 10) {
    out.push({ y, major: y % 100 === 0 })
  }
  return out
})
</script>

<template>
  <div class="stage-shell">
    <!-- Outer wrapper sizes itself to the frame and provides the
         positioning context for rulers, which live OUTSIDE the frame
         (above and to the left) so they never overlap toy content
         and don't get clipped by the frame's `overflow: hidden`. -->
    <div class="stage-frame-outer">
      <!-- Rulers (rendered as siblings of the frame, not inside it) -->
      <template v-if="showRuler">
        <div class="stage-ruler stage-ruler-top">
          <span
            v-for="t in horizTicks"
            :key="`ht-${t.x}`"
            class="tick"
            :class="{ major: t.major }"
            :style="{ left: `${t.x}px` }"
          >
            <span v-if="t.major" class="tick-label">{{ t.x }}</span>
          </span>
        </div>
        <div class="stage-ruler stage-ruler-left">
          <span
            v-for="t in vertTicks"
            :key="`vt-${t.y}`"
            class="tick"
            :class="{ major: t.major }"
            :style="{ top: `${t.y}px` }"
          >
            <span v-if="t.major" class="tick-label">{{ t.y }}</span>
          </span>
        </div>
      </template>

      <div
        ref="frameRef"
        class="stage-frame"
        :class="[bgClass, { 'with-border': showBorder, 'full-bleed': fullBleed }]"
        :style="frameStyle"
      >
        <div class="stage-content" :style="contentStyle">
          <slot />
        </div>
      </div>

      <!-- Dimension badge — sits OUTSIDE the frame in the bottom-right
           gutter so it never overlaps toy content. Hidden while
           recording via `body.bt-recording`. -->
      <div class="stage-dim-badge" aria-hidden="true">{{ dimBadge }}</div>
    </div>
  </div>
</template>

<style scoped>
.stage-shell {
  /* Scroll + centring container for the frame. Padding lives INSIDE
     the frame (on `.stage-content`) so the recording dimensions stay
     exactly `width × height` — the padding is treated as a "safe
     area" inside the recorded box, not as breathing room around it.
     The shell itself gets a bit of inner padding so the rulers
     (which sit OUTSIDE the frame) have room to breathe and aren't
     immediately clipped against the shell edge for small frames. */
  position: relative;
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 40px;
  box-sizing: border-box;
  display: flex;
  /* Use `margin: auto` on the frame (below) instead of
     `justify-content: center` so a frame larger than the shell still
     anchors to the start edge cleanly when scrolling. */
  /* Checkerboard sits behind the stage frame so the user can see the
     frame edges against the surrounding "page". Built from the site's
     dark-mode page bg + soft surface so it stays in the same colour
     family as the actual rendered marketing site. */
  background-color: var(--vp-c-bg, #111318);
  background-image:
    linear-gradient(45deg, var(--vp-c-bg-soft, #16181f) 25%, transparent 25%),
    linear-gradient(-45deg, var(--vp-c-bg-soft, #16181f) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--vp-c-bg-soft, #16181f) 75%),
    linear-gradient(-45deg, transparent 75%, var(--vp-c-bg-soft, #16181f) 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, 10px 0px;
}

.stage-frame-outer {
  /* Sized to the frame inside it. Acts as the positioning context
     for the rulers, which use negative offsets to sit just outside
     the frame edges. `margin: auto` centres the wrap (and therefore
     the frame + rulers) in the shell when there's spare room. */
  position: relative;
  flex: 0 0 auto;
  margin: auto;
}

.stage-frame {
  position: relative;
  display: block;
  overflow: hidden;
  resize: both;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06);
  min-width: 120px;
  min-height: 80px;
}

.stage-frame.with-border {
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.12),
    0 0 0 2px rgba(0, 0, 0, 0.6);
}

/* Background presets — the `dark` / `surface` defaults are the same
   tokens the live marketing site uses in dark mode, so a recording on
   either preset matches the page it came from. */
.stage-frame.bg-dark {
  background-color: var(--vp-c-bg, #111318);
}
.stage-frame.bg-surface {
  background-color: var(--vp-c-bg-soft, #16181f);
}
.stage-frame.bg-elv {
  background-color: var(--vp-c-bg-elv, #22252f);
}
.stage-frame.bg-light {
  background-color: #f5f5f5;
}
.stage-frame.bg-white {
  background-color: #ffffff;
}
.stage-frame.bg-black {
  background-color: #000000;
}
.stage-frame.bg-transparent {
  background-color: transparent;
  background-image:
    linear-gradient(45deg, var(--vp-c-divider, #2a2d38) 25%, transparent 25%),
    linear-gradient(-45deg, var(--vp-c-divider, #2a2d38) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--vp-c-divider, #2a2d38) 75%),
    linear-gradient(-45deg, transparent 75%, var(--vp-c-divider, #2a2d38) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, 8px 0px;
}

.stage-content {
  /* Explicitly-sized "safe area" inside the frame. `top`, `left`,
     `width`, `height` are all set inline by `contentStyle` based on
     the frame size and the padding prop, so the toy mounts into a
     parent that's already the correct inset size. This works
     uniformly across toys regardless of whether they use normal
     flow, `position: absolute; inset: 0`, `width/height: 100%`, or
     anything else — the parent is just the right size to begin with. */
  position: absolute;
}

.stage-frame.full-bleed .stage-content > :deep(*:first-child) {
  /* Hero backgrounds expect to be positioned inside a sized parent.
     Force them to fill the safe-area content box. */
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* Dimension badge — sits in the gutter immediately BELOW the frame,
   anchored to the right edge so it lines up with the bottom-right
   corner without overlapping any toy content. */
.stage-dim-badge {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  padding: 2px 6px;
  font-family: var(--vp-font-family-mono, ui-monospace, monospace);
  font-size: 10px;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(0, 0, 0, 0.55);
  border-radius: 3px;
  pointer-events: none;
  z-index: 2;
  white-space: nowrap;
}

/* Rulers — rendered OUTSIDE the frame as siblings (above and to the
   left of the frame). Each is anchored to the corresponding frame
   edge from the outside via a negative offset, so ticks point INTO
   the frame edge and labels read AWAY from the frame. */
.stage-ruler {
  position: absolute;
  pointer-events: none;
  color: rgba(255, 255, 255, 0.4);
  z-index: 1;
}
.stage-ruler-top {
  /* Sits in the gutter immediately above the frame, spanning the
     full frame width. The ruler bar's bottom edge butts up against
     the frame's top edge. */
  bottom: 100%;
  left: 0;
  right: 0;
  height: 14px;
}
.stage-ruler-left {
  /* Sits in the gutter immediately to the left of the frame,
     spanning the full frame height. The ruler bar's right edge butts
     up against the frame's left edge. */
  right: 100%;
  top: 0;
  bottom: 0;
  width: 18px;
}

.stage-ruler .tick {
  position: absolute;
  display: block;
  background: rgba(255, 255, 255, 0.25);
}
/* Top ruler: ticks anchored to the BOTTOM of the bar (i.e. the frame
   edge), pointing up away from the frame. */
.stage-ruler-top .tick {
  width: 1px;
  height: 4px;
  bottom: 0;
}
.stage-ruler-top .tick.major {
  height: 8px;
  background: rgba(255, 255, 255, 0.55);
}
/* Left ruler: ticks anchored to the RIGHT of the bar (i.e. the frame
   edge), pointing left away from the frame. */
.stage-ruler-left .tick {
  height: 1px;
  width: 4px;
  right: 0;
}
.stage-ruler-left .tick.major {
  width: 8px;
  background: rgba(255, 255, 255, 0.55);
}

.tick-label {
  position: absolute;
  font-family: var(--vp-font-family-mono, ui-monospace, monospace);
  font-size: 9px;
  color: rgba(255, 255, 255, 0.55);
}
/* Top labels sit above the ruler bar, away from the frame. */
.stage-ruler-top .tick-label {
  bottom: 100%;
  margin-bottom: 1px;
  transform: translateX(-50%);
  left: 0;
}
/* Left labels sit to the left of the ruler bar, away from the frame. */
.stage-ruler-left .tick-label {
  right: 100%;
  margin-right: 3px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  text-align: right;
}

/* Hide all chrome when body has `.bt-recording` — triggered by pressing H.
   NOTE: each rule wraps its full selector in a single `:global(...)`. Vue's
   scoped-CSS compiler doesn't handle `:global(body.x) .y, :global(body.x) .z`
   correctly — it can collapse comma-separated `:global(...)` lists in a
   way that ends up matching `body.x` itself with `display: none`, hiding
   the entire page. Keep each selector on its own rule. */
:global(body.bt-recording .stage-dim-badge) {
  display: none;
}
:global(body.bt-recording .stage-ruler) {
  display: none;
}
:global(body.bt-recording .stage-frame) {
  box-shadow: none;
}
/* Disable the CSS `resize: both` corner handle while recording — the
   browser-rendered drag affordance is otherwise still visible in the
   bottom-right corner of the frame. */
:global(body.bt-recording .stage-frame) {
  resize: none;
}
</style>
