<script setup>
// Entry point for the agent-loop animation. Wires the composable to the
// three presentational pieces (loop SVG, pipe, durable log) and computes
// the pipe geometry on mount / resize so the pipe floats absolutely over
// the layout and visually connects the spawning slice to the top of the
// durable log.

import {
  onBeforeUnmount,
  onMounted,
  nextTick,
  ref,
  shallowRef,
  watch,
} from 'vue'

import AgentLoopSvg from './AgentLoopSvg.vue'
import DataPipe from './DataPipe.vue'
import DurableLog from './DurableLog.vue'

import { useAgentLoopAnimation } from './useAgentLoopAnimation.js'

const { slices, pulseActive, logEntries, pipeTick } =
  useAgentLoopAnimation()

// --- refs into the DOM ---------------------------------------------------

const layoutRef = ref(null)
const agentLoopSvgRef = ref(null)
const durableLogRef = ref(null)

// --- pipe geometry -------------------------------------------------------

// Breakpoint must match the CSS in the child components.
const MOBILE_BREAKPOINT = 500

// SVG exit points in viewBox (1024x1024) coordinates.
//
// Desktop: visually-tuned to sit flush against the spawn slice on the
// right-hand side, slightly above its mid-line. SPAWN_PATH's right edge
// runs roughly from (985, 295) at the top to (985, 408) at the bottom,
// and the visual "corner" the pipe should hang off sits a touch up and
// in from the path's mathematical extreme. Encoding the nudge in viewBox
// coordinates keeps the pipe flush at any layout width.
const DESKTOP_EXIT_SVG = { x: 970, y: 339 }

// Mobile: the spawn slice is rotated 150deg around (512, 512). We want a
// point on the original (un-rotated) path that, after rotation, lands at
// the visible bottom-left of the slice — i.e. somewhere a downward
// vertical pipe can drop from. The path's top-left-ish corner
// (`L785.509 349.674`) rotates to roughly (356, 789):
//   dx = 273.509, dy = -162.326
//   cos(150°) = -0.866, sin(150°) = 0.5
//   x' = 273.509 * -0.866 - (-162.326) * 0.5 + 512 ≈ 356.3
//   y' = 273.509 *  0.5  + (-162.326) * -0.866 + 512 ≈ 789.3
// That places the pipe under the visible spawn slice on mobile.
const MOBILE_EXIT_SVG = { x: 356, y: 789 }

const pipeGeometry = shallowRef(null)

// Vertical offset (px) applied to the log slot on desktop so that the top
// log entry's progress bar lines up with the pipe's top edge. Recomputed
// on mount, on resize, and whenever the first entry appears.
const logOffset = ref(0)

// Sane fallback for the position of the first .entry-bar within
// .log-section before any entries have been rendered. Derived from the
// known box model in DurableLog.vue:
//   log-header padding+border+text ≈ 50px (margin-bottom 24)
//   first .log-entry padding-top 8 + entry-header ≈ 18 + gap 6 ≈ 32
// Total ≈ 80px from the top of .log-section.
const LOG_FIRST_BAR_FALLBACK = 80

function svgToLayout(svgRect, layoutRect, sx, sy) {
  const x = svgRect.left + (sx / 1024) * svgRect.width - layoutRect.left
  const y = svgRect.top + (sy / 1024) * svgRect.height - layoutRect.top
  return { x, y }
}

function recomputePipe() {
  const layoutEl = layoutRef.value
  const svgEl = agentLoopSvgRef.value?.svgRef
  const logEntriesEl = durableLogRef.value?.logEntriesRef
  if (!layoutEl || !svgEl || !logEntriesEl) {
    return
  }

  const layoutRect = layoutEl.getBoundingClientRect()
  const svgRect = svgEl.getBoundingClientRect()
  const logRect = logEntriesEl.getBoundingClientRect()

  // Must match the CSS media query in the child components, which uses
  // the viewport width (not the layout width). matchMedia keeps them in
  // lockstep so the JS-computed geometry matches the CSS layout.
  const isMobile =
    typeof window !== 'undefined' &&
    window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches

  if (isMobile) {
    // Vertical pipe: straight down from the rotated spawn corner to the top
    // of the log-entries container. No log offset on mobile — the column
    // layout already places the log directly below the loop.
    logOffset.value = 0

    const exit = svgToLayout(
      svgRect,
      layoutRect,
      MOBILE_EXIT_SVG.x,
      MOBILE_EXIT_SVG.y,
    )
    const x = exit.x
    const y1 = exit.y
    const y2 = logRect.top - layoutRect.top
    if (y2 <= y1) {
      // Log is above the exit (shouldn't happen in column-reverse layout but
      // guard anyway). Hide the pipe by collapsing it to zero height.
      pipeGeometry.value = { x1: x, y1, x2: x, y2: y1 + 1 }
    } else {
      pipeGeometry.value = { x1: x, y1, x2: x, y2 }
    }
  } else {
    // Horizontal pipe: from the bottom-right corner of the spawn slice to
    // the left edge of the log-entries container. The pipe's top-left
    // corner sits exactly at the slice corner — DataPipe interprets the
    // geometry as pixel-exact corners, no offset.
    const exit = svgToLayout(
      svgRect,
      layoutRect,
      DESKTOP_EXIT_SVG.x,
      DESKTOP_EXIT_SVG.y,
    )
    const sliceExitLayoutY = exit.y
    const x1 = exit.x

    // Find the first progress bar inside the log so we can shift the log
    // vertically to align it with the pipe.
    const firstBar = logEntriesEl.querySelector('.entry-bar')
    let progressBarLayoutY
    if (firstBar) {
      const barRect = firstBar.getBoundingClientRect()
      progressBarLayoutY = barRect.top - layoutRect.top
    } else {
      // No entries yet — fall back to a precomputed approximation of where
      // the first bar will land relative to the log-section top.
      progressBarLayoutY =
        logRect.top - layoutRect.top + LOG_FIRST_BAR_FALLBACK
    }

    // Subtract whatever offset we already applied so the measurement
    // reflects the natural (un-shifted) layout position of the bar.
    const naturalProgressBarY = progressBarLayoutY - logOffset.value
    let desiredOffset = sliceExitLayoutY - naturalProgressBarY

    // Clamp so the log can't be pushed off-screen. Allow the log to move
    // up by at most its own height and down by at most the layout height.
    const layoutHeight = layoutRect.height
    const maxDown = Math.max(0, layoutHeight - logRect.height)
    desiredOffset = Math.max(-logRect.height, Math.min(desiredOffset, maxDown))
    logOffset.value = desiredOffset

    const y = sliceExitLayoutY
    const x2 = logRect.left - layoutRect.left
    if (x2 <= x1) {
      pipeGeometry.value = { x1, y1: y, x2: x1 + 1, y2: y }
    } else {
      pipeGeometry.value = { x1, y1: y, x2, y2: y }
    }
  }
}

// --- lifecycle -----------------------------------------------------------

let resizeObserver = null

onMounted(() => {
  nextTick(() => {
    recomputePipe()
  })
  if (typeof ResizeObserver !== 'undefined' && layoutRef.value) {
    resizeObserver = new ResizeObserver(() => {
      recomputePipe()
    })
    resizeObserver.observe(layoutRef.value)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', recomputePipe)
  }
})

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', recomputePipe)
  }
})

// Recompute when the first log entry appears (or after a wipe), so the
// log can lock onto the actual rendered .entry-bar instead of the
// fallback approximation.
watch(
  () => logEntries.value.length,
  (next, prev) => {
    if ((prev ?? 0) === 0 && next > 0) {
      nextTick(() => {
        recomputePipe()
      })
    }
  },
)
</script>

<template>
  <div class="agent-loop-animation">
    <div ref="layoutRef" class="layout">
      <div class="agent-loop-slot">
        <AgentLoopSvg
          ref="agentLoopSvgRef"
          :slices="slices"
          :pulse-active="pulseActive"
        />
      </div>
      <div
        class="log-slot"
        :style="{ transform: `translateY(${logOffset}px)` }"
      >
        <DurableLog ref="durableLogRef" :entries="logEntries" />
      </div>
      <DataPipe :pipe-tick="pipeTick" :geometry="pipeGeometry" />
    </div>
  </div>
</template>

<style scoped>
.agent-loop-animation {
  width: 100%;
  margin: 32px 0;
}

.layout {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  position: relative;
  gap: 10%;
}

.agent-loop-slot {
  flex: 0 0 45%;
  display: flex;
  justify-content: center;
}

.log-slot {
  flex: 0 0 45%;
  display: flex;
  justify-content: center;
  /* Smooth the alignment shift so it doesn't pop on first entry. */
  transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform;
}

@media (max-width: 499px) {
  .layout {
    flex-direction: column;
    align-items: flex-start;
    gap: 24px;
    padding: 24px;
  }

  .agent-loop-slot,
  .log-slot {
    flex: 0 0 auto;
    width: 100%;
    justify-content: flex-start;
  }

  .log-slot {
    /* No vertical offset on mobile. */
    transform: none !important;
  }
}
</style>
