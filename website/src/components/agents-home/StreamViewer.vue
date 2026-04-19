<script setup lang="ts">
import { ref, watch, nextTick } from "vue"

export interface StreamEvent {
  id: string
  timestamp: string
  direction: "inbound" | "outbound"
  type: "message" | "run" | "tool_call" | "tool_result" | "text" | "error"
  label: string
  content?: string
}

const props = defineProps<{
  events: StreamEvent[]
  title?: string
  status?: "active" | "sleeping" | "crashed"
}>()

const listRef = ref<HTMLElement>()

async function scrollToBottom() {
  await nextTick()
  if (listRef.value) {
    listRef.value.scrollTo({ top: listRef.value.scrollHeight, behavior: "smooth" })
  }
}

watch(() => props.events.length, scrollToBottom)
watch(() => props.status, scrollToBottom)
</script>

<template>
  <div class="stream-viewer">
    <div class="stream-header">
      <span class="stream-title">{{ title ?? "Stream" }}</span>
      <span
        class="stream-status"
        :class="status ?? 'active'"
        :title="status ?? 'active'"
      />
    </div>
    <div ref="listRef" class="stream-list">
      <TransitionGroup name="event">
        <div
          v-for="event in events"
          :key="event.id"
          class="stream-event"
          :class="event.type"
        >
          <span class="event-time">{{ event.timestamp }}</span>
          <span class="event-arrow">{{
            event.direction === "inbound" ? "←" : "→"
          }}</span>
          <span class="event-badge">{{ event.label }}</span>
          <span v-if="event.content" class="event-content">{{
            event.content
          }}</span>
        </div>
      </TransitionGroup>
      <div
        v-if="status === 'sleeping'"
        class="stream-sleep-marker"
      >
        <span>sleeping — zero compute</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stream-viewer {
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.stream-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--ea-surface-alt);
  border-bottom: 1px solid var(--ea-divider);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: var(--ea-text-2);
}

/* Dark mode: invert chrome — header sits above a darker body. */
.dark .stream-viewer {
  background: var(--ea-surface-alt);
}
.dark .stream-header {
  background: var(--ea-surface);
}

.stream-title {
  font-weight: 500;
}

.stream-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.stream-status.active {
  background: var(--ea-indicator-active);
  box-shadow: 0 0 6px var(--ea-indicator-active);
}

.stream-status.sleeping {
  background: var(--ea-indicator-sleep);
}

.stream-status.crashed {
  background: var(--ea-event-error);
}

.stream-list {
  flex: 1 1 0;
  overflow-y: auto;
  padding: 8px 0;
  min-height: 0;
  scrollbar-width: none;
}

.stream-list::-webkit-scrollbar {
  display: none;
}

.stream-event {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 16px;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.5;
}

.event-time {
  color: var(--ea-text-2);
  font-size: 12px;
  min-width: 56px;
  text-align: right;
  flex-shrink: 0;
}

.event-arrow {
  flex-shrink: 0;
  width: 14px;
  text-align: center;
}

.event-badge {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 1px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}

.event-content {
  color: var(--ea-text-2);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Event type colours */
.stream-event.message .event-badge {
  background: color-mix(in srgb, var(--ea-event-message) 15%, transparent);
  color: var(--ea-event-message);
}
.stream-event.message .event-arrow {
  color: var(--ea-event-message);
}

.stream-event.run .event-badge {
  background: color-mix(in srgb, var(--ea-event-run) 15%, transparent);
  color: var(--ea-event-run);
}
.stream-event.run .event-arrow {
  color: var(--ea-event-run);
}

.stream-event.tool_call .event-badge {
  background: color-mix(in srgb, var(--ea-event-tool-call) 15%, transparent);
  color: var(--ea-event-tool-call);
}
.stream-event.tool_call .event-arrow {
  color: var(--ea-event-tool-call);
}

.stream-event.tool_result .event-badge {
  background: color-mix(
    in srgb,
    var(--ea-event-tool-result) 15%,
    transparent
  );
  color: var(--ea-event-tool-result);
}
.stream-event.tool_result .event-arrow {
  color: var(--ea-event-tool-result);
}

.stream-event.text .event-badge {
  background: color-mix(in srgb, var(--ea-event-text) 15%, transparent);
  color: var(--ea-event-text);
}
.stream-event.text .event-arrow {
  color: var(--ea-event-text);
}

.stream-event.error .event-badge {
  background: color-mix(in srgb, var(--ea-event-error) 15%, transparent);
  color: var(--ea-event-error);
}
.stream-event.error .event-arrow {
  color: var(--ea-event-error);
}

/* Sleep marker */
.stream-sleep-marker {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 16px;
  margin: 8px 16px;
  border-top: 1px dashed var(--ea-divider);
  border-bottom: 1px dashed var(--ea-divider);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--ea-indicator-sleep);
}

/* Entry animation */
.event-enter-active {
  transition: all 0.3s ease-out;
}

.event-enter-from {
  opacity: 0;
  transform: translateX(12px);
}

@media (max-width: 480px) {
  .stream-header {
    font-size: 11px;
    padding: 8px 12px;
  }
  .stream-event {
    font-size: 11px;
    gap: 6px;
    padding: 3px 12px;
  }
  .event-time {
    font-size: 10px;
    min-width: 44px;
  }
  .event-badge {
    font-size: 9px;
    padding: 1px 4px;
  }
  .event-content {
    font-size: 11px;
  }
  .stream-sleep-marker {
    font-size: 10px;
    padding: 8px 12px;
    margin: 6px 12px;
  }
}
</style>
