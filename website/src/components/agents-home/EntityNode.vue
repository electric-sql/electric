<script setup lang="ts">
defineProps<{
  name: string
  status?: 'active' | 'sleeping' | 'idle' | 'crashed' | 'busy'
  compact?: boolean
}>()
</script>

<template>
  <div class="entity-node" :class="[status ?? 'idle', { compact }]">
    <div class="entity-indicator" />
    <span class="entity-name">{{ name }}</span>
    <span class="entity-status-label">{{ status ?? 'idle' }}</span>
  </div>
</template>

<style scoped>
.entity-node {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  transition:
    border-color 0.3s,
    box-shadow 0.3s;
  white-space: nowrap;
}

.entity-node.compact {
  padding: 4px 8px;
  gap: 5px;
  border-radius: 6px;
}

.entity-node.active,
.entity-node.busy {
  border-color: var(--ea-indicator-active);
  box-shadow: 0 0 8px
    color-mix(in srgb, var(--ea-indicator-active) 25%, transparent);
}

.entity-node.crashed {
  border-color: var(--ea-event-error);
}

.entity-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  transition:
    background 0.3s,
    box-shadow 0.3s;
}

.entity-node.active .entity-indicator,
.entity-node.busy .entity-indicator {
  background: var(--ea-indicator-active);
  box-shadow: 0 0 6px var(--ea-indicator-active);
  animation: pulse 2s ease-in-out infinite;
}

.entity-node.sleeping .entity-indicator,
.entity-node.idle .entity-indicator {
  background: var(--ea-indicator-sleep);
}

.entity-node.crashed .entity-indicator {
  background: var(--ea-event-error);
}

.entity-name {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--ea-text-1);
  line-height: 1.3;
}

.entity-node.compact .entity-name {
  font-size: 11px;
}

.entity-node.compact .entity-indicator {
  width: 6px;
  height: 6px;
}

.entity-node.compact .entity-status-label {
  font-size: 9px;
  width: 5em;
}

.entity-status-label {
  font-size: 11px;
  color: var(--ea-text-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  line-height: 1;
  width: 5.5em;
  text-align: left;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
