<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue"
import StreamViewer from "./StreamViewer.vue"
import type { StreamEvent } from "./StreamViewer.vue"
import { useDemoVisibility } from "../../composables/useDemoVisibility"

type Phase = "active" | "crash" | "recovery" | "pause"

const SCRIPT: Omit<StreamEvent, "id" | "timestamp">[] = [
  { direction: "inbound", type: "message", label: "wake", content: undefined },
  { direction: "outbound", type: "run", label: "run.start", content: undefined },
  { direction: "outbound", type: "text", label: "text", content: '"Let me look into that..."' },
  { direction: "outbound", type: "tool_call", label: "tool_call", content: 'search({query: "..."})' },
  { direction: "inbound", type: "tool_result", label: "tool_result", content: '"Found 3 results"' },
  { direction: "outbound", type: "text", label: "text", content: '"Based on my research..."' },
]

const PHASE_LABELS: Record<Phase, string> = {
  active: "Active",
  crash: "Crashed!",
  recovery: "Recovering...",
  pause: "Sleeping",
}

const events = ref<StreamEvent[]>([])
const phase = ref<Phase>("pause")
const status = ref<"active" | "sleeping" | "crashed">("sleeping")
const replayingIndex = ref(-1)
const showCrashOverlay = ref(false)
const showReplayLabel = ref(false)

const rootRef = ref<HTMLElement>()
const visible = useDemoVisibility(rootRef)
let timers: ReturnType<typeof setTimeout>[] = []
let running = false

function later(ms: number): Promise<void> {
  return new Promise((resolve) => {
    timers.push(setTimeout(resolve, ms))
  })
}

function clearTimers() {
  timers.forEach(clearTimeout)
  timers = []
}

function makeTimestamp(index: number): string {
  const s = index * 2
  const mins = Math.floor(s / 60)
  const secs = s % 60
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

function makeEvent(index: number): StreamEvent {
  const s = SCRIPT[index]
  return {
    id: `${Date.now()}-${index}`,
    timestamp: makeTimestamp(index),
    ...s,
  }
}

async function runLoop() {
  running = true

  while (running) {
    if (!visible.value) {
      await later(200)
      continue
    }

    // Phase 1 — ACTIVE
    events.value = []
    phase.value = "active"
    status.value = "active"
    replayingIndex.value = -1
    showCrashOverlay.value = false
    showReplayLabel.value = false

    for (let i = 0; i < SCRIPT.length; i++) {
      if (!running) return
      await later(500)
      events.value = [...events.value, makeEvent(i)]
    }
    await later(500)

    if (!running) return

    // Phase 2 — CRASH
    phase.value = "crash"
    status.value = "crashed"
    showCrashOverlay.value = true
    await later(2000)

    if (!running) return

    // Phase 3 — RECOVERY
    phase.value = "recovery"
    status.value = "active"
    showCrashOverlay.value = false
    showReplayLabel.value = true

    for (let i = 0; i < events.value.length; i++) {
      if (!running) return
      replayingIndex.value = i
      await later(50)
    }
    replayingIndex.value = -1
    await later(400)
    showReplayLabel.value = false

    // New events after recovery
    const continueEvent: StreamEvent = {
      id: `${Date.now()}-continue`,
      timestamp: makeTimestamp(SCRIPT.length),
      direction: "outbound",
      type: "text",
      label: "text",
      content: '"Continuing where I left off..."',
    }
    events.value = [...events.value, continueEvent]
    await later(600)

    if (!running) return

    const endEvent: StreamEvent = {
      id: `${Date.now()}-end`,
      timestamp: makeTimestamp(SCRIPT.length + 1),
      direction: "outbound",
      type: "run",
      label: "run.end",
    }
    events.value = [...events.value, endEvent]
    await later(900)

    if (!running) return

    // Phase 4 — PAUSE
    phase.value = "pause"
    status.value = "sleeping"
    await later(2000)
  }
}

onMounted(() => {
  runLoop()
})

onUnmounted(() => {
  running = false
  clearTimers()
})
</script>

<template>
  <div ref="rootRef" class="crash-demo">
    <div class="demo-status-bar">
      <span class="demo-entity-path">/agents/research-agent</span>
      <span class="demo-phase-label" :class="phase">{{ PHASE_LABELS[phase] }}</span>
    </div>

    <div class="demo-viewer-wrap">
      <StreamViewer
        :events="events"
        title="/agents/research-agent/stream"
        :status="status"
        :class="{
          'viewer-crashed': showCrashOverlay,
          'viewer-replaying': showReplayLabel,
        }"
      />

      <!-- Crash overlay -->
      <Transition name="crash-overlay">
        <div v-if="showCrashOverlay" class="crash-overlay">
          <div class="crash-message">
            <span class="crash-icon">⚠</span>
            <span>Process crashed</span>
          </div>
        </div>
      </Transition>

      <!-- Replay label -->
      <Transition name="replay-label">
        <div v-if="showReplayLabel" class="replay-label">
          Replaying stream…
        </div>
      </Transition>

      <!-- Per-event replay flash overlay -->
      <div
        v-if="replayingIndex >= 0"
        class="replay-scanline"
        :style="{ top: `${44 + replayingIndex * 28}px` }"
      />
    </div>
  </div>
</template>

<style scoped>
.crash-demo {
  width: 100%;
}

.demo-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  margin-bottom: 8px;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: var(--ea-text-2);
}

.demo-entity-path {
  font-weight: 500;
  color: var(--ea-text-1);
}

.demo-phase-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 8px;
  border-radius: 4px;
  transition: color 0.3s, background 0.3s;
}

.demo-phase-label.active {
  color: var(--ea-indicator-active);
  background: color-mix(in srgb, var(--ea-indicator-active) 12%, transparent);
}

.demo-phase-label.crash {
  color: var(--ea-event-error);
  background: color-mix(in srgb, var(--ea-event-error) 12%, transparent);
}

.demo-phase-label.recovery {
  color: var(--ea-event-text);
  background: color-mix(in srgb, var(--ea-event-text) 12%, transparent);
}

.demo-phase-label.pause {
  color: var(--ea-indicator-sleep);
  background: color-mix(in srgb, var(--ea-indicator-sleep) 12%, transparent);
}

/* Viewer wrapper for overlays */
.demo-viewer-wrap {
  position: relative;
  height: 240px;
}

.demo-viewer-wrap :deep(.stream-viewer) {
  height: 100%;
}

/* Dim events during crash */
.demo-viewer-wrap :deep(.viewer-crashed .stream-list) {
  opacity: 0.45;
  transition: opacity 0.4s;
}

.demo-viewer-wrap :deep(.stream-list) {
  transition: opacity 0.3s;
}

/* Crash overlay */
.crash-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--ea-event-error);
  border-radius: 8px;
  background: color-mix(in srgb, var(--ea-event-error) 6%, transparent);
  pointer-events: none;
  z-index: 2;
}

.crash-message {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: var(--ea-surface);
  border: 1px solid var(--ea-event-error);
  border-radius: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--ea-event-error);
  box-shadow: 0 4px 24px color-mix(in srgb, var(--ea-event-error) 15%, transparent);
}

.crash-icon {
  font-size: 16px;
}

.crash-overlay-enter-active {
  transition: opacity 0.25s ease-out;
}

.crash-overlay-leave-active {
  transition: opacity 0.2s ease-in;
}

.crash-overlay-enter-from,
.crash-overlay-leave-to {
  opacity: 0;
}

/* Replay label */
.replay-label {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 3px 10px;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 500;
  color: var(--ea-event-text);
  background: color-mix(in srgb, var(--ea-event-text) 12%, var(--ea-surface));
  border: 1px solid color-mix(in srgb, var(--ea-event-text) 25%, transparent);
  border-radius: 4px;
  z-index: 3;
}

.replay-label-enter-active {
  transition: opacity 0.2s ease-out;
}

.replay-label-leave-active {
  transition: opacity 0.3s ease-in;
}

.replay-label-enter-from,
.replay-label-leave-to {
  opacity: 0;
}

/* Replay scanline — a brief cyan highlight over the row being replayed */
.replay-scanline {
  position: absolute;
  left: 1px;
  right: 1px;
  height: 28px;
  background: color-mix(in srgb, var(--ea-event-text) 15%, transparent);
  border-left: 2px solid var(--ea-event-text);
  pointer-events: none;
  z-index: 1;
  transition: top 0.04s linear;
}

@media (max-width: 768px) {
  .crash-demo {
    max-width: 100%;
    overflow: hidden;
  }
  .demo-viewer-wrap {
    height: 220px;
  }
  .demo-status-bar {
    font-size: 12px;
    padding: 6px 12px;
  }
}
</style>
