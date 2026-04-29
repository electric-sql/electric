<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  active?: boolean
  direction?: 'down' | 'up' | 'right' | 'left'
  dashed?: boolean
  label?: string
}>()

const dotRef = ref<HTMLElement>()
const animating = ref(false)
let timeout: ReturnType<typeof setTimeout> | undefined

function animatePulse() {
  if (!props.active) return
  animating.value = true
  timeout = setTimeout(() => {
    animating.value = false
  }, 600)
}

onMounted(() => {
  if (props.active) animatePulse()
})

onUnmounted(() => {
  if (timeout) clearTimeout(timeout)
})

defineExpose({ animatePulse })
</script>

<template>
  <div class="message-line" :class="[direction ?? 'down', { dashed, active }]">
    <div class="line-track">
      <div ref="dotRef" v-if="active" class="line-dot" :class="{ animating }" />
    </div>
    <span v-if="label" class="line-label">{{ label }}</span>
  </div>
</template>

<style scoped>
.message-line {
  display: flex;
  align-items: center;
  position: relative;
}

.message-line.down,
.message-line.up {
  flex-direction: column;
  width: 2px;
  min-height: 32px;
}

.message-line.right,
.message-line.left {
  flex-direction: row;
  height: 2px;
  min-width: 32px;
}

.line-track {
  flex: 1;
  position: relative;
}

.message-line.down .line-track,
.message-line.up .line-track {
  width: 2px;
  min-height: 32px;
  background: var(--ea-divider);
}

.message-line.right .line-track,
.message-line.left .line-track {
  height: 2px;
  min-width: 32px;
  background: var(--ea-divider);
}

.message-line.dashed .line-track {
  background: none;
}

.message-line.dashed.down .line-track,
.message-line.dashed.up .line-track {
  border-left: 2px dashed var(--ea-divider);
}

.message-line.dashed.right .line-track,
.message-line.dashed.left .line-track {
  border-top: 2px dashed var(--ea-divider);
}

.message-line.active .line-track {
  background: var(--ea-indicator-active);
}

.message-line.active.dashed .line-track {
  background: none;
  border-color: var(--ea-indicator-active);
}

.line-dot {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ea-indicator-active);
  box-shadow: 0 0 6px var(--ea-indicator-active);
}

.message-line.down .line-dot,
.message-line.up .line-dot {
  left: -3px;
  top: 0;
}

.message-line.right .line-dot,
.message-line.left .line-dot {
  top: -3px;
  left: 0;
}

.line-dot.animating {
  animation: travel 0.6s ease-out forwards;
}

.message-line.down .line-dot.animating {
  animation-name: travel-down;
}

.message-line.up .line-dot.animating {
  animation-name: travel-up;
}

.message-line.right .line-dot.animating {
  animation-name: travel-right;
}

.line-label {
  font-size: 11px;
  color: var(--ea-text-2);
  padding: 2px 6px;
  white-space: nowrap;
}

@keyframes travel-down {
  from {
    top: 0%;
    opacity: 1;
  }
  to {
    top: 100%;
    opacity: 0;
  }
}

@keyframes travel-up {
  from {
    bottom: 0%;
    opacity: 1;
  }
  to {
    bottom: 100%;
    opacity: 0;
  }
}

@keyframes travel-right {
  from {
    left: 0%;
    opacity: 1;
  }
  to {
    left: 100%;
    opacity: 0;
  }
}
</style>
