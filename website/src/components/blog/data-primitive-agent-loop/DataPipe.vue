<script setup>
// The pipe between the loop and the durable log.
//
// DataPipe is absolutely positioned inside the `.layout` container. The
// parent computes a `geometry` object (in layout-local pixel coordinates)
// that describes where the pipe starts and ends; DataPipe just translates
// that into a thin line + a sweep element.
//
// The sweep fill child is re-keyed on every `pipeTick` bump so the CSS
// keyframe restarts cleanly each time the composable fires it. The
// keyframe direction depends on the orientation (horizontal vs vertical).

import { computed } from 'vue'

const props = defineProps({
  pipeTick: {
    type: Number,
    required: true,
  },
  geometry: {
    type: Object,
    default: null,
  },
})

// Thickness of the pipe rail (the short axis). Matches the original
// 12px look closely enough to keep the gradient sweep readable.
const RAIL_THICKNESS = 5

const style = computed(() => {
  if (!props.geometry) {
    return { display: 'none' }
  }
  const { x1, y1, x2, y2 } = props.geometry
  const horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1)
  if (horizontal) {
    return {
      left: `${Math.min(x1, x2)}px`,
      top: `${y1}px`,
      width: `${Math.max(1, Math.abs(x2 - x1))}px`,
      height: `${RAIL_THICKNESS}px`,
    }
  } else {
    return {
      left: `${x1}px`,
      top: `${Math.min(y1, y2)}px`,
      width: `${RAIL_THICKNESS}px`,
      height: `${Math.max(1, Math.abs(y2 - y1))}px`,
    }
  }
})

const orientation = computed(() => {
  if (!props.geometry) return 'horizontal'
  const { x1, y1, x2, y2 } = props.geometry
  return Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? 'horizontal' : 'vertical'
})
</script>

<template>
  <div class="pipe" :class="orientation" :style="style">
    <div :key="pipeTick" class="pipe-fill" />
  </div>
</template>

<style scoped>
.pipe {
  position: absolute;
  pointer-events: none;
  overflow: hidden;
  background: rgba(117, 251, 253, 0.03);
}

.pipe.horizontal {
  border-top: 1px solid rgba(117, 251, 253, 0.4);
  border-bottom: 1px solid rgba(117, 251, 253, 0.4);
}

.pipe.vertical {
  border-left: 1px solid rgba(117, 251, 253, 0.4);
  border-right: 1px solid rgba(117, 251, 253, 0.4);
}

.pipe-fill {
  position: absolute;
}

.pipe.horizontal .pipe-fill {
  top: 0;
  left: -40%;
  width: 40%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(117, 251, 253, 0.9),
    transparent
  );
  animation: pipe-flow-horizontal 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.pipe.vertical .pipe-fill {
  left: 0;
  top: -40%;
  width: 100%;
  height: 40%;
  background: linear-gradient(
    180deg,
    transparent,
    rgba(117, 251, 253, 0.9),
    transparent
  );
  animation: pipe-flow-vertical 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

@keyframes pipe-flow-horizontal {
  0% {
    left: -40%;
  }
  100% {
    left: 100%;
  }
}

@keyframes pipe-flow-vertical {
  0% {
    top: -40%;
  }
  100% {
    top: 100%;
  }
}
</style>
