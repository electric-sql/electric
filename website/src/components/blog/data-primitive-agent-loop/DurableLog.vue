<script setup>
// The durable log panel. Renders the entries from the composable, newest
// first. Each entry has its own progress bar that the composable fills as
// the corresponding slice writes through the pipe.

defineProps({
  entries: {
    type: Array,
    required: true,
  },
})
</script>

<template>
  <div class="log-section">
    <div class="log-entries">
      <transition-group name="log-entry">
        <div v-for="entry in entries" :key="entry.id" class="log-entry">
          <div class="entry-header">
            <span class="entry-label">{{ entry.label }}</span>
            <span class="entry-time">{{ entry.time }}</span>
          </div>
          <div class="entry-bar">
            <div
              class="entry-bar-fill"
              :style="{ width: `${Math.round(entry.progress * 100)}%` }"
            />
          </div>
        </div>
      </transition-group>
    </div>
  </div>
</template>

<style scoped>
.log-section {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.log-entries {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
  /* Fixed footprint that fits exactly 7 entries so the layout doesn't
     jump as the composable accumulates entries or wipes them on cycle
     restart. Empirically each entry-with-gap renders at ~60px (entry box
     ≈ 48px + 12px gap), so 7 entries fit in 7 * 48 + 6 * 12 = 408px,
     plus a small buffer for font-metric variation. */
  height: 412px;
}

.log-entry {
  border-left: 2px solid rgba(117, 251, 253, 0.4);
  background: rgba(117, 251, 253, 0.05);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transform-origin: top;
}

.entry-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.entry-label {
  font-size: 10px;
  font-weight: 700;
  color: #75fbfd;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  font-family: var(--vp-font-family-mono);
}

.entry-time {
  font-size: 8px;
  color: rgba(117, 251, 253, 0.3);
  font-family: var(--vp-font-family-mono);
}

.entry-bar {
  height: 2px;
  background: rgba(117, 251, 253, 0.1);
  width: 100%;
  border-radius: 9999px;
  overflow: hidden;
}

.entry-bar-fill {
  height: 100%;
  background: rgba(117, 251, 253, 0.8);
  transition: width 0.1s linear;
}

.log-entry-enter-active {
  animation: entry-slide 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes entry-slide {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
