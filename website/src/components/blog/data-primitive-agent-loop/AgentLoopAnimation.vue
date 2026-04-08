<script setup>
// Entry point for the agent-loop animation. Wires the composable to the
// three presentational pieces (loop SVG, pipe, durable log). Layout and
// pipe geometry are handled entirely in CSS via container query units,
// so there is no JS for positioning, resize handling, or pipe geometry.
//
// The animation is started and stopped as the component scrolls into
// and out of view so it doesn't burn cycles (or distract) while the
// reader is elsewhere on the page.

import { onBeforeUnmount, onMounted, ref } from 'vue'

import AgentLoopSvg from './AgentLoopSvg.vue'
import DataPipe from './DataPipe.vue'
import DurableLog from './DurableLog.vue'

import { useAgentLoopAnimation } from './useAgentLoopAnimation.js'

const { slices, pulseActive, logEntries, pipeTick, start, stop } =
  useAgentLoopAnimation()

const rootRef = ref(null)
let observer = null

onMounted(() => {
  // Fallback: if IntersectionObserver isn't available, just run.
  if (typeof IntersectionObserver === 'undefined' || !rootRef.value) {
    start()
    return
  }
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        start()
      } else {
        stop()
      }
    }
  })
  observer.observe(rootRef.value)
})

onBeforeUnmount(() => {
  if (observer) {
    observer.disconnect()
    observer = null
  }
})
</script>

<template>
  <div ref="rootRef" class="agent-loop-animation">
    <div class="layout">
      <div class="loop-slot">
        <AgentLoopSvg :slices="slices" :pulse-active="pulseActive" />
      </div>
      <div class="log-slot">
        <DurableLog :entries="logEntries" />
      </div>
      <DataPipe :pipe-tick="pipeTick" />
    </div>
  </div>
</template>

<style scoped>
/*
 * The outer wrapper is the container query context. `.layout` sits
 * inside it so its own properties (gap, etc.) can resolve `cqw` units
 * against this container — an element cannot query its own container.
 */
.agent-loop-animation {
  width: 100%;
  container-type: inline-size;
}

/*
 * Layout is a two-column flex row on desktop, stacking on mobile. All
 * positions inside it are expressed as fractions of the outer container
 * width using `cqw`.
 *
 * Desktop geometry:
 *   - loop and log are each 45cqw wide, with a 10cqw gap
 *   - the loop SVG has aspect-ratio 1/1, so loop height = 45cqw
 *   - the spawn slice exits at viewBox (970, 339) in a 1024x1024 box,
 *     which is (970/1024, 339/1024) of the loop's dimensions
 *   - the log's first entry must sit at the same Y as the slice exit,
 *     so the log slot takes a matching padding-top
 *
 * See DataPipe.vue for the matching pipe position.
 */
.layout {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 10cqw;
}

.loop-slot {
  flex: 0 0 45cqw;
}

.log-slot {
  flex: 0 0 45cqw;
  /* Align the first entry's progress bar (not its top) with the pipe.
     45cqw * (339 / 1024) is the Y of the spawn slice exit; -36.5px
     shifts the entry up so its internal progress bar lands on that Y. */
  padding-top: calc(45cqw * 339 / 1024 - 36.5px);
}

/*
 * Mobile: stack vertically. The slice is rotated 150° inside AgentLoopSvg
 * so the spawn position lands at the bottom-left of the loop; the pipe
 * drops straight down to the top of the log.
 */
@media (max-width: 499px) {
  .agent-loop-animation {
    max-width: 300px;
    margin: 0 auto;
  }

  .layout {
    flex-direction: column;
    gap: 24px;
  }

  .loop-slot,
  .log-slot {
    flex: 0 0 auto;
    width: 100%;
    padding-top: 0;
  }
}
</style>
