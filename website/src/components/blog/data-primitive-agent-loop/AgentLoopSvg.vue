<script setup>
// The agent loop visualisation. Pure render: takes the live slices and a
// pulse flag from the composable and draws them. The clip-path on each
// slice is recreated per render so the top-down reveal animation works
// without DOM mutation in the parent.
//
// The pulse, outline and fill groups are wrapped in a shared `.slices-rotator`
// group so the whole spawn area can be rotated via CSS for the mobile layout
// (puts the spawning slice near the bottom of the loop).

import { ref } from 'vue'

import { MAX_VISIBLE_SLICES, SPAWN_PATH } from './sequence.js'

defineProps({
  slices: {
    type: Array,
    required: true,
  },
  pulseActive: {
    type: Boolean,
    default: false,
  },
})

// Pre-computed rotations for the always-on outline ring (one outline at
// each of the 12 spawn positions). Drawn underneath the live slices so
// the loop's shape is visible even before the cycle has populated every
// position. Without this the upper half of the loop reads as empty space
// for the first half of every cycle.
const outlineSlots = Array.from(
  { length: MAX_VISIBLE_SLICES },
  (_, i) => i * (360 / MAX_VISIBLE_SLICES)
)

const svgRef = ref(null)

defineExpose({ svgRef })
</script>

<template>
  <div class="agent-loop-wrapper">
    <div class="svg-frame">
      <svg
        ref="svgRef"
        class="agent-loop-svg"
        viewBox="0 0 1024 1024"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <clipPath
            v-for="slice in slices"
            :key="`clip-${slice.id}`"
            :id="`clip-${slice.id}`"
          >
            <rect
              x="512"
              y="0"
              width="512"
              :height="slice.clipHeight === null ? 1024 : slice.clipHeight"
            />
          </clipPath>
        </defs>

        <g class="slices-rotator">
          <!-- pulse overlay (LLM_THINKING) -->
          <path
            v-if="pulseActive"
            class="pulse-slice"
            :d="SPAWN_PATH"
            fill="rgba(117, 251, 253, 0.05)"
            stroke="#75fbfd"
            stroke-width="1"
          />

          <!-- ghost outlines for every slot in the ring (always on, so
               the loop reads as a complete shape from the first frame) -->
          <g class="slice-outlines">
            <path
              v-for="(rotation, i) in outlineSlots"
              :key="`outline-slot-${i}`"
              :d="SPAWN_PATH"
              fill="none"
              stroke="#75fbfd"
              stroke-width="1"
              stroke-opacity="0.18"
              :style="{
                transform: `rotate(${rotation}deg)`,
                transformOrigin: '512px 512px',
              }"
            />
          </g>

          <!-- slice fills (clipped) -->
          <g class="slices">
            <path
              v-for="slice in slices"
              :key="`fill-${slice.id}`"
              :d="SPAWN_PATH"
              class="slice"
              fill="#75fbfd"
              :fill-opacity="slice.fillOpacity"
              stroke="none"
              :clip-path="`url(#clip-${slice.id})`"
              :style="{
                transform: `rotate(${slice.rotation}deg)`,
                transformOrigin: '512px 512px',
              }"
            />
          </g>
        </g>
      </svg>
    </div>
    <div class="caption">
      <span>AGENT LOOP</span>
    </div>
  </div>
</template>

<style scoped>
.agent-loop-wrapper {
  flex-shrink: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
}

.svg-frame {
  width: 100%;
  aspect-ratio: 1 / 1;
  position: relative;
}

.agent-loop-svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}

.slice {
  transition: transform 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}

.pulse-slice {
  animation: pulse-cyan 1.5s infinite ease-in-out;
}

@keyframes pulse-cyan {
  0%,
  100% {
    opacity: 0.1;
  }
  50% {
    opacity: 0.4;
  }
}

.caption {
  margin-top: 12px;
  text-align: center;
  font-size: 11px;
  letter-spacing: 0.3em;
  color: rgba(117, 251, 253, 0.8);
  font-weight: 900;
  text-transform: uppercase;
  font-family: var(--vp-font-family-mono);
  display: none;
}

/* Mobile: move the spawn area to the bottom of the loop by rotating the
   whole slices-rotator group. 150deg takes the 2 o'clock spawn position
   to roughly the 7 o'clock (bottom-left) area. Also flip the column so
   the caption sits on top. */
@media (max-width: 499px) {
  .agent-loop-wrapper {
    max-width: 300px;
    align-self: flex-start;
    align-items: flex-start;
    flex-direction: column-reverse;
  }

  .slices-rotator {
    transform: rotate(150deg);
    transform-box: view-box;
    transform-origin: 512px 512px;
  }

  .caption {
    margin-top: 0;
    margin-bottom: 12px;
    text-align: left;
  }
}
</style>
