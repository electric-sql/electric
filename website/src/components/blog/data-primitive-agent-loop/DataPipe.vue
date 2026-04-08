<script setup>
// The pipe between the loop and the durable log.
//
// DataPipe is absolutely positioned inside the `.layout` container. All
// of its geometry is expressed in container query units (`cqw`) so it
// tracks the loop and log without any JS measurement.
//
// The sweep fill child is re-keyed on every `pipeTick` bump so the CSS
// keyframe restarts cleanly each time the composable fires it. The
// media query switches between horizontal (desktop) and vertical
// (mobile) sweep animations.

defineProps({
  pipeTick: {
    type: Number,
    required: true,
  },
})
</script>

<template>
  <div class="pipe">
    <div :key="pipeTick" class="pipe-fill" />
  </div>
</template>

<style scoped>
/*
 * Desktop: horizontal pipe from the spawn slice exit to the left edge
 * of the log. Loop is 0..45cqw, gap is 45..55cqw, log starts at 55cqw.
 * Slice exit X = 45cqw * (970/1024). Slice exit Y = 45cqw * (339/1024).
 * Pipe runs from exit X to 55cqw (the log's left edge), at exit Y.
 */
.pipe {
  position: absolute;
  left: calc(45cqw * 970 / 1024);
  top: calc(45cqw * 339 / 1024);
  width: calc(55cqw - 45cqw * 970 / 1024);
  height: 5px;
  pointer-events: none;
  overflow: hidden;
  background: rgba(117, 251, 253, 0.03);
  border-top: 1px solid rgba(117, 251, 253, 0.4);
  border-bottom: 1px solid rgba(117, 251, 253, 0.4);
}

.pipe-fill {
  position: absolute;
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

@keyframes pipe-flow-horizontal {
  0% {
    left: -40%;
  }
  100% {
    left: 100%;
  }
}

/*
 * Mobile: vertical pipe. The slices-rotator in AgentLoopSvg is rotated
 * 150° about the viewBox centre, which takes the spawn path's
 * (930.228, 275.038) corner — the tip that becomes the visible bottom
 * of the rotated slice — to roughly (268, 926) in the loop's coordinate
 * space. The loop fills the column width, so loop width = loop height
 * = 100cqw, and the pipe drops from that point through the 24px gap to
 * the top of the log.
 */
@media (max-width: 499px) {
  .pipe {
    left: calc(100cqw * 268 / 1024);
    /* -3px nudges the pipe up so it sits flush with the slice edge. */
    top: calc(100cqw * 926 / 1024 - 3px);
    width: 5px;
    height: calc(100cqw - 100cqw * 926 / 1024 + 27px);
    border-top: none;
    border-bottom: none;
    border-left: 1px solid rgba(117, 251, 253, 0.4);
    border-right: 1px solid rgba(117, 251, 253, 0.4);
  }

  .pipe-fill {
    top: -40%;
    left: 0;
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
