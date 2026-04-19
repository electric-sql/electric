<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue"
import StreamViewer from "./StreamViewer.vue"
import { useDemoVisibility } from "../../composables/useDemoVisibility"

interface StreamEvent {
  id: string
  timestamp: string
  direction: "inbound" | "outbound"
  type: "message" | "run" | "tool_call" | "tool_result" | "text" | "error"
  label: string
  content?: string
}

interface ScriptStep {
  delay: number
  event?: { localId: string } & Omit<StreamEvent, "id">
  status?: "active" | "sleeping"
  highlightLine?: number | null
}

const SCRIPT: ScriptStep[] = [
  {
    delay: 0,
    event: {
      localId: "1",
      timestamp: "0:00.0",
      direction: "inbound",
      type: "message",
      label: "wake",
      content: "message received",
    },
    status: "active",
    highlightLine: 1,
  },
  {
    delay: 800,
    event: {
      localId: "2",
      timestamp: "0:00.8",
      direction: "outbound",
      type: "run",
      label: "run.start",
    },
    highlightLine: 7,
  },
  {
    delay: 1400,
    event: {
      localId: "3",
      timestamp: "0:01.4",
      direction: "outbound",
      type: "text",
      label: "text",
      content: "Let me calculate that...",
    },
    highlightLine: 4,
  },
  {
    delay: 2200,
    event: {
      localId: "4",
      timestamp: "0:02.2",
      direction: "outbound",
      type: "tool_call",
      label: "tool_call",
      content: 'calculator({ expr: "2+2" })',
    },
    highlightLine: 5,
  },
  {
    delay: 2600,
    event: {
      localId: "5",
      timestamp: "0:02.6",
      direction: "inbound",
      type: "tool_result",
      label: "tool_result",
      content: "4",
    },
    highlightLine: 5,
  },
  {
    delay: 3400,
    event: {
      localId: "6",
      timestamp: "0:03.4",
      direction: "outbound",
      type: "text",
      label: "text",
      content: "The answer is 4.",
    },
    highlightLine: 4,
  },
  {
    delay: 3800,
    event: {
      localId: "7",
      timestamp: "0:03.8",
      direction: "outbound",
      type: "run",
      label: "run.end",
    },
    highlightLine: 7,
  },
  { delay: 4200, status: "sleeping", highlightLine: null },
  {
    delay: 7000,
    event: {
      localId: "8",
      timestamp: "0:07.0",
      direction: "inbound",
      type: "message",
      label: "wake",
      content: "new message received",
    },
    status: "active",
    highlightLine: 1,
  },
  {
    delay: 7400,
    event: {
      localId: "9",
      timestamp: "0:07.4",
      direction: "outbound",
      type: "run",
      label: "run.start",
    },
    highlightLine: 7,
  },
  {
    delay: 8000,
    event: {
      localId: "10",
      timestamp: "0:08.0",
      direction: "outbound",
      type: "text",
      label: "text",
      content: "Hello again! I remember our last conversation.",
    },
    highlightLine: 4,
  },
  {
    delay: 8600,
    event: {
      localId: "11",
      timestamp: "0:08.6",
      direction: "outbound",
      type: "run",
      label: "run.end",
    },
    highlightLine: 7,
  },
  { delay: 9000, status: "sleeping", highlightLine: null },
]

const CYCLE_MS = 13000

const CODE_LINES = [
  '<span class="tk-v">registry</span>.<span class="tk-fn">define</span>(<span class="tk-str">"assistant"</span>, {',
  '  <span class="tk-kw">async</span> <span class="tk-fn">handler</span>(<span class="tk-v">ctx</span>) {',
  '    <span class="tk-v">ctx</span>.<span class="tk-fn">useAgent</span>({',
  '      <span class="tk-prop">systemPrompt</span>: <span class="tk-str">"You are a helpful assistant."</span>,',
  '      <span class="tk-prop">model</span>: <span class="tk-str">"claude-sonnet-4-5-20250929"</span>,',
  '      <span class="tk-prop">tools</span>: [<span class="tk-v">calculatorTool</span>, ...<span class="tk-v">ctx</span>.<span class="tk-v">darixTools</span>],',
  "    })",
  '    <span class="tk-kw">await</span> <span class="tk-v">ctx</span>.<span class="tk-v">agent</span>.<span class="tk-fn">run</span>()',
  "  },",
  "})",
]

const rootRef = ref<HTMLElement>()
const events = ref<StreamEvent[]>([])
const status = ref<"active" | "sleeping">("sleeping")
const highlightLine = ref<number | null>(null)
const isVisible = useDemoVisibility(rootRef)

let cycleId = 0
const pendingTimers: ReturnType<typeof setTimeout>[] = []

function clearTimers() {
  pendingTimers.forEach(clearTimeout)
  pendingTimers.length = 0
}

function runCycle() {
  clearTimers()
  events.value = []
  status.value = "sleeping"
  highlightLine.value = null
  cycleId++
  const thisCycle = cycleId

  for (const step of SCRIPT) {
    pendingTimers.push(
      setTimeout(() => {
        if (cycleId !== thisCycle) return
        if (step.event) {
          const { localId, ...rest } = step.event
          events.value = [
            ...events.value,
            { ...rest, id: `${thisCycle}-${localId}` },
          ]
        }
        if (step.status !== undefined) status.value = step.status
        if (step.highlightLine !== undefined)
          highlightLine.value = step.highlightLine
      }, step.delay)
    )
  }

  pendingTimers.push(
    setTimeout(() => {
      if (cycleId !== thisCycle) return
      runCycle()
    }, CYCLE_MS)
  )
}

watch(isVisible, (v) => {
  if (v) runCycle()
  else clearTimers()
})

onUnmounted(() => {
  clearTimers()
})
</script>

<template>
  <div ref="rootRef" class="entity-stream-demo">
    <div class="demo-container">
      <div class="entity-header">
        <span class="entity-path">Entity: /assistant/helper</span>
        <span class="entity-dot" :class="status" />
      </div>

      <div class="demo-panes">
        <div class="code-pane">
          <div class="pane-header">handler.ts</div>
          <div class="code-body">
            <div
              v-for="(line, i) in CODE_LINES"
              :key="i"
              class="code-line"
              :class="{ highlight: highlightLine === i }"
            >
              <span class="line-num">{{ i + 1 }}</span>
              <span class="line-content" v-html="line" />
            </div>
          </div>
        </div>

        <div class="stream-pane">
          <StreamViewer :events="events" title="Stream" :status="status" />
        </div>
      </div>
    </div>

    <div class="introspection-callout">
      <p>
        Every agent is fully introspectable. The stream is a complete audit
        trail — what you see above is the actual data model.
      </p>
    </div>
  </div>
</template>

<style scoped>
.entity-stream-demo {
  width: 100%;
}

/* ── Outer container ─────────────────────────────────────────────────── */

.demo-container {
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  overflow: hidden;
  background: var(--ea-surface);
}

/* Dark mode: invert chrome — headers sit above a darker body. */
.dark .demo-container {
  background: var(--ea-surface-alt);
}
.dark .entity-header,
.dark .pane-header {
  background: var(--ea-surface);
}

/* ── Entity header ───────────────────────────────────────────────────── */

.entity-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--ea-surface-alt);
  border-bottom: 1px solid var(--ea-divider);
}

.entity-path {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--ea-text-1);
}

.entity-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background 0.3s, box-shadow 0.3s;
}

.entity-dot.active {
  background: var(--ea-indicator-active);
  box-shadow: 0 0 6px var(--ea-indicator-active);
}

.entity-dot.sleeping {
  background: var(--ea-indicator-sleep);
}

/* ── Split panes ─────────────────────────────────────────────────────── */

.demo-panes {
  display: flex;
  height: 340px;
}

.code-pane {
  flex: 1;
  min-width: 0;
  border-right: 1px solid var(--ea-divider);
  display: flex;
  flex-direction: column;
}

.stream-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* Strip StreamViewer's own chrome so it blends with the container */
.stream-pane :deep(.stream-viewer) {
  border: none;
  border-radius: 0;
  flex: 1;
}

/* ── Code pane ───────────────────────────────────────────────────────── */

.pane-header {
  padding: 10px 16px;
  background: var(--ea-surface-alt);
  border-bottom: 1px solid var(--ea-divider);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--ea-text-2);
}

.code-body {
  flex: 1;
  overflow-x: auto;
  padding: 12px 0;
}

.code-line {
  display: flex;
  align-items: baseline;
  padding: 1px 16px 1px 0;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre;
  color: var(--ea-text-2);
  border-left: 2px solid transparent;
  transition: background 0.25s, border-color 0.25s;
}

.code-line.highlight {
  background: color-mix(in srgb, var(--vp-c-brand-1) 8%, transparent);
  border-left-color: var(--vp-c-brand-1);
}

.line-num {
  width: 36px;
  text-align: right;
  padding-right: 16px;
  color: var(--ea-text-2);
  opacity: 0.4;
  flex-shrink: 0;
  user-select: none;
  font-size: 12px;
}

.line-content {
  flex: 1;
  min-width: 0;
}

/* ── Syntax tokens ───────────────────────────────────────────────────── */

.code-line :deep(.tk-kw) {
  color: var(--vp-c-brand-1);
}

.code-line :deep(.tk-fn) {
  color: var(--ea-event-message);
}

.code-line :deep(.tk-str) {
  color: var(--ea-event-tool-result);
}

.code-line :deep(.tk-prop) {
  color: var(--ea-event-tool-call);
}

.code-line :deep(.tk-v) {
  color: var(--ea-text-1);
}

/* ── Introspection callout ───────────────────────────────────────────── */

.introspection-callout {
  margin-top: 24px;
  padding: 16px 20px;
  border-left: 3px solid var(--vp-c-brand-1);
  font-size: 14px;
  line-height: 1.6;
  color: var(--ea-text-2);
}

.introspection-callout p {
  margin: 0;
}

/* ── Responsive ──────────────────────────────────────────────────────── */

@media (max-width: 767px) {
  .demo-panes {
    flex-direction: column;
    height: auto;
  }

  .code-pane {
    border-right: none;
    border-bottom: 1px solid var(--ea-divider);
  }

  .stream-pane {
    min-height: 260px;
  }
}

@media (max-width: 480px) {
  .code-pane pre {
    font-size: 11px;
  }
  .ev-type {
    font-size: 11px;
  }
  .ev-body {
    font-size: 11px;
  }
}
</style>
