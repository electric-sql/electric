<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onBeforeUnmount, onMounted } from "vue"
import { useDemoVisibility } from "../../../.vitepress/theme/composables/useDemoVisibility"

const props = defineProps<{
  // When true, render a fixed snapshot of the support sub-agents
  // act (classify + search-kb done, draft in flight) instead of
  // running the looping animation. Used by the homepage product
  // section so the embedded preview reads as a frozen moment of
  // the live demo.
  paused?: boolean
}>()

const containerRef = ref<HTMLElement>()
const logRef = ref<HTMLElement>()
const isActive = useDemoVisibility(containerRef)

interface AgentRow {
  id: string
  path: string
  depth: number
  status: "sleeping" | "active" | "done"
  events: number
  barWidth: number
  visible: boolean
}

interface LogEntry {
  id: number
  icon: string
  text: string
  fading: boolean
}

const agents = reactive<AgentRow[]>([
  { id: "support",    path: "support/ticket-1190",                   depth: 0, status: "sleeping", events: 3,  barWidth: 0, visible: true },
  { id: "classify",   path: "support/classify-1190",                 depth: 1, status: "sleeping", events: 0,  barWidth: 0, visible: false },
  { id: "search-kb",  path: "support/search-kb-1190",                depth: 1, status: "sleeping", events: 0,  barWidth: 0, visible: false },
  { id: "draft",      path: "support/draft-reply-1190",              depth: 1, status: "sleeping", events: 0,  barWidth: 0, visible: false },
  { id: "product",    path: "product-desc/optimise-sku-8842",        depth: 0, status: "sleeping", events: 12, barWidth: 0, visible: true },
  { id: "coding",     path: "coding-agent/pr-review-47",             depth: 0, status: "sleeping", events: 0,  barWidth: 0, visible: true },
  { id: "deploy",     path: "deploy/pipeline-89",                    depth: 0, status: "sleeping", events: 5,  barWidth: 0, visible: true },
])

const log = reactive<LogEntry[]>([])
let logId = 0
const pendingTimers: ReturnType<typeof setTimeout>[] = []

function schedule(fn: () => void, delay: number) {
  const id = setTimeout(() => {
    const idx = pendingTimers.indexOf(id)
    if (idx >= 0) pendingTimers.splice(idx, 1)
    fn()
  }, delay)
  pendingTimers.push(id)
  return id
}

const logFading = ref(false)

function addLog(icon: string, text: string) {
  log.push({ id: logId++, icon, text, fading: false })
  nextTick(() => {
    if (logRef.value) {
      logRef.value.scrollTo({ top: logRef.value.scrollHeight, behavior: "smooth" })
    }
  })
}

function clearLog(): Promise<void> {
  return new Promise(resolve => {
    logFading.value = true
    schedule(() => {
      log.length = 0
      logId = 0
      if (logRef.value) logRef.value.scrollTop = 0
      logFading.value = false
      resolve()
    }, 400)
  })
}

function find(id: string) {
  return agents.find(a => a.id === id)!
}

const defaultEvents: Record<string, number> = {
  support: 3, product: 12, deploy: 5, coding: 0,
}

function resetAgents() {
  for (const a of agents) {
    a.status = "sleeping"
    a.events = defaultEvents[a.id] ?? 0
    a.barWidth = 0
    a.visible = a.depth === 0
  }
}

function startBarGrowth(agent: AgentRow, targetWidth: number, durationMs: number) {
  const startWidth = agent.barWidth
  const startTime = Date.now()
  const step = () => {
    const elapsed = Date.now() - startTime
    const progress = Math.min(elapsed / durationMs, 1)
    agent.barWidth = startWidth + (targetWidth - startWidth) * progress
    if (progress < 1 && agent.status === "active") {
      requestAnimationFrame(step)
    }
  }
  requestAnimationFrame(step)
}

function runSequence() {
  const steps: Array<[number, () => void]> = [
    // --- Act 1: Support ticket with sub-agents ---
    [0, () => {
      addLog("←", "webhook: new support ticket #1190")
    }],
    [500, () => {
      const s = find("support")
      s.status = "active"
      s.events = 4
      startBarGrowth(s, 15, 600)
      addLog("⚡", "support/ticket-1190 woke")
    }],
    [1200, () => {
      const s = find("support")
      s.events = 5
      startBarGrowth(s, 25, 400)
      const c = find("classify")
      c.visible = true
      schedule(() => {
        c.status = "active"
        c.events = 1
        startBarGrowth(c, 40, 1000)
      }, 150)
      addLog("→", "spawned classify-1190 (sentiment)")
    }],
    [1800, () => {
      const s = find("support")
      s.events = 6
      startBarGrowth(s, 35, 400)
      const kb = find("search-kb")
      kb.visible = true
      schedule(() => {
        kb.status = "active"
        kb.events = 1
        startBarGrowth(kb, 30, 1200)
      }, 150)
      addLog("→", "spawned search-kb-1190 (RAG)")
    }],
    [2600, () => {
      const c = find("classify")
      c.events = 2
      startBarGrowth(c, 70, 300)
    }],
    [3100, () => {
      const c = find("classify")
      c.status = "done"
      c.barWidth = 100
      addLog("✓", "classify-1190: urgent, billing issue")
    }],
    [3600, () => {
      const kb = find("search-kb")
      kb.events = 3
      startBarGrowth(kb, 70, 400)
    }],
    [4200, () => {
      const kb = find("search-kb")
      kb.status = "done"
      kb.barWidth = 100
      addLog("✓", "search-kb-1190: 3 articles found")
    }],
    [4800, () => {
      const s = find("support")
      s.events = 7
      startBarGrowth(s, 55, 400)
      const d = find("draft")
      d.visible = true
      schedule(() => {
        d.status = "active"
        d.events = 1
        startBarGrowth(d, 50, 1200)
      }, 150)
      addLog("→", "spawned draft-reply-1190 (LLM)")
    }],
    [6200, () => {
      const d = find("draft")
      d.events = 4
      d.status = "done"
      d.barWidth = 100
      addLog("✓", "draft-reply-1190: response ready")
    }],
    [6800, () => {
      const s = find("support")
      s.status = "done"
      s.barWidth = 100
      addLog("✓", "support/ticket-1190 replied")
    }],
    [7800, () => {
      find("classify").visible = false
      find("search-kb").visible = false
      find("draft").visible = false
    }],
    [8400, () => {
      for (const id of ["classify", "search-kb", "draft", "support"]) {
        const a = find(id)
        a.status = "sleeping"
        a.events = defaultEvents[a.id] ?? 0
        a.barWidth = 0
      }
    }],

    // --- Act 2: Product description optimisation wakes ---
    [9200, () => {
      addLog("←", "queue: optimise SKU-8842 listing")
    }],
    [9700, () => {
      const p = find("product")
      p.status = "active"
      p.events = 13
      startBarGrowth(p, 30, 1500)
      addLog("⚡", "product-desc/optimise-sku-8842 woke")
    }],
    [11000, () => {
      const p = find("product")
      p.events = 15
      startBarGrowth(p, 70, 800)
    }],
    [12000, () => {
      const p = find("product")
      p.status = "done"
      p.barWidth = 100
      addLog("✓", "optimise-sku-8842: copy updated")
    }],
    [13000, () => {
      const p = find("product")
      p.status = "sleeping"
      p.events = defaultEvents.product ?? 0
      p.barWidth = 0
    }],

    // --- Act 3: Coding agent wakes from GitHub ---
    [13800, () => {
      addLog("←", "github: PR #47 opened")
    }],
    [14300, () => {
      const c = find("coding")
      c.status = "active"
      c.events = 1
      startBarGrowth(c, 40, 2000)
      addLog("⚡", "coding-agent/pr-review-47 woke")
    }],
    [16000, () => {
      const c = find("coding")
      c.events = 6
      startBarGrowth(c, 80, 600)
    }],
    [16800, () => {
      const c = find("coding")
      c.status = "done"
      c.barWidth = 100
      addLog("✓", "pr-review-47: 3 comments posted")
    }],
    [17800, () => {
      const c = find("coding")
      c.status = "sleeping"
      c.events = 0
      c.barWidth = 0
    }],

    // --- Loop ---
    [19000, () => {
      resetAgents()
      clearLog().then(() => {
        runSequence()
      })
    }],
  ]

  // convert absolute times to relative delays
  const relSteps: Array<[number, () => void]> = []
  for (let j = 0; j < steps.length; j++) {
    const delay = j === 0 ? steps[0][0] : steps[j][0] - steps[j - 1][0]
    relSteps.push([delay, steps[j][1]])
  }

  let idx = 0
  function runNext() {
    if (idx >= relSteps.length) return
    const [delay, fn] = relSteps[idx]
    idx++
    schedule(() => {
      fn()
      runNext()
    }, Math.max(delay, 50))
  }
  runNext()
}

function stopAnimation() {
  for (const id of pendingTimers) clearTimeout(id)
  pendingTimers.length = 0
}

// Paused snapshot: support is active mid-flight, classify and
// search-kb have completed, draft is in progress, plus the matching
// log entries. Avoids both the animation loop and the visibility
// watcher so the snapshot stays put.
function applyPausedSnapshot() {
  const snapshot: Record<string, Partial<AgentRow>> = {
    support:   { status: "active", events: 7, barWidth: 55, visible: true },
    classify:  { status: "done",   events: 2, barWidth: 100, visible: true },
    "search-kb": { status: "done", events: 3, barWidth: 100, visible: true },
    draft:     { status: "active", events: 1, barWidth: 50, visible: true },
    product:   { status: "sleeping", events: 12, barWidth: 0, visible: true },
    coding:    { status: "sleeping", events: 0,  barWidth: 0, visible: true },
    deploy:    { status: "sleeping", events: 5,  barWidth: 0, visible: true },
  }
  for (const a of agents) {
    const s = snapshot[a.id]
    if (s) Object.assign(a, s)
  }
  log.length = 0
  logId = 0
  const lines: Array<[string, string]> = [
    ["←", "webhook: new support ticket #1190"],
    ["⚡", "support/ticket-1190 woke"],
    ["→", "spawned classify-1190 (sentiment)"],
    ["→", "spawned search-kb-1190 (RAG)"],
    ["✓", "classify-1190: urgent, billing issue"],
    ["✓", "search-kb-1190: 3 articles found"],
    ["→", "spawned draft-reply-1190 (LLM)"],
  ]
  for (const [icon, text] of lines) log.push({ id: logId++, icon, text, fading: false })
}

if (props.paused) {
  // Skip the visibility-driven animation entirely — the snapshot
  // is applied in onMounted (and again here so SSR markup is
  // populated even before mount runs).
  applyPausedSnapshot()
} else {
  watch(isActive, (active) => {
    if (active) {
      resetAgents()
      log.length = 0
      logId = 0
      logFading.value = false
      if (logRef.value) logRef.value.scrollTop = 0
      runSequence()
    } else {
      stopAnimation()
      resetAgents()
      log.length = 0
      logId = 0
      logFading.value = false
    }
  })
}

onMounted(() => {
  if (props.paused) {
    applyPausedSnapshot()
    nextTick(() => {
      if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight
    })
  }
})

onBeforeUnmount(() => {
  stopAnimation()
})

function statusLabel(s: string) {
  if (s === "active") return "active"
  if (s === "done") return "done"
  return "sleeping"
}

const visibleAgents = computed(() => agents.filter(a => a.visible || a.depth === 0))

function isLastChild(agent: AgentRow): boolean {
  if (agent.depth === 0) return false
  const vis = visibleAgents.value
  const idx = vis.indexOf(agent)
  if (idx < 0) return false
  const next = vis[idx + 1]
  return !next || next.depth === 0
}
</script>

<template>
  <div ref="containerRef" class="monitor">
    <div class="monitor-header">
      <span class="monitor-title">agents</span>
      <span class="monitor-dot"></span>
    </div>
    <div class="monitor-body">
      <div class="agent-list">
        <TransitionGroup name="agent-row">
          <div
            v-for="agent in visibleAgents"
            :key="agent.id"
            class="agent-row"
            :class="[agent.status, { child: agent.depth > 0 }]"
          >
            <span v-if="agent.depth > 0" class="tree-line" :class="{ last: isLastChild(agent) }"></span>
            <span class="status-dot" :class="agent.status"></span>
            <span class="agent-path">{{ agent.path }}</span>
            <span class="agent-bar">
              <span class="agent-bar-fill" :style="{ width: agent.barWidth + '%' }"></span>
            </span>
            <span class="agent-events">{{ agent.events }}</span>
            <span class="agent-status-label" :class="agent.status">{{ statusLabel(agent.status) }}</span>
          </div>
        </TransitionGroup>
      </div>
      <div ref="logRef" class="log-area" :class="{ fading: logFading }">
        <div class="log-entries">
          <div
            v-for="entry in log"
            :key="entry.id"
            class="log-line"
          >
            <span class="log-icon">{{ entry.icon }}</span>
            <span class="log-text">{{ entry.text }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.monitor {
  border: 1px solid var(--ea-divider);
  border-radius: 10px;
  overflow: hidden;
  background: var(--ea-bg-soft);
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  line-height: 1.5;
}

.monitor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-bottom: 1px solid var(--ea-divider);
  background: color-mix(in srgb, var(--ea-bg-soft) 80%, transparent);
}

/* Dark mode: invert the chrome — header sits a step *above* the body so the
   listing area reads as the deepest surface. */
.dark .monitor {
  background: var(--ea-bg);
}
.dark .monitor-header {
  background: var(--ea-bg-soft);
}
.monitor-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ea-text-3, #888);
}
.monitor-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22c55e;
}

.monitor-body {
  display: flex;
  flex-direction: column;
}

.agent-list {
  padding: 6px 0;
  height: 210px;
  overflow: hidden;
}

.agent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
  transition: background 0.3s, opacity 0.3s;
}
.agent-row.active {
  background: color-mix(in srgb, var(--ea-brand) 6%, transparent);
}
.agent-row.done {
  background: color-mix(in srgb, #22c55e 4%, transparent);
}
.agent-row.child {
  padding-left: 14px;
  position: relative;
}

.tree-line {
  flex-shrink: 0;
  width: 20px;
  position: relative;
}
.tree-line::before {
  content: "";
  position: absolute;
  left: 6px;
  top: -5px;
  bottom: -5px;
  width: 1px;
  background: var(--ea-text-3, #555);
  opacity: 0.4;
}
.tree-line::after {
  content: "";
  position: absolute;
  left: 6px;
  top: 50%;
  width: 11px;
  height: 1px;
  background: var(--ea-text-3, #555);
  opacity: 0.4;
}
.tree-line.last::before {
  bottom: 50%;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background 0.3s;
}
.status-dot.sleeping {
  background: var(--ea-indicator-sleep);
}
.status-dot.active {
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
}
.status-dot.done {
  background: var(--ea-brand);
}

.agent-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ea-text-2);
}
.agent-row.active .agent-path {
  color: var(--ea-text-1);
}

.agent-bar {
  width: 48px;
  height: 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--ea-text-3, #555) 30%, transparent);
  overflow: hidden;
  flex-shrink: 0;
}
.agent-bar-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--ea-brand);
  transition: width 0.3s ease-out;
  opacity: 0.7;
}
.agent-row.done .agent-bar-fill {
  background: #22c55e;
  opacity: 0.5;
}
.agent-row.sleeping .agent-bar-fill {
  opacity: 0;
}

.agent-events {
  width: 16px;
  text-align: right;
  color: var(--ea-text-3, #888);
  font-size: 11px;
  flex-shrink: 0;
}
.agent-row.active .agent-events {
  color: var(--ea-text-2);
}

.agent-status-label {
  width: 52px;
  text-align: right;
  font-size: 11px;
  flex-shrink: 0;
}
.agent-status-label.sleeping {
  color: var(--ea-text-3, #666);
}
.agent-status-label.active {
  color: #22c55e;
}
.agent-status-label.done {
  color: var(--ea-brand);
}

/* Row transitions */
.agent-row-enter-active {
  transition: all 0.35s ease-out;
}
.agent-row-leave-active {
  transition: all 0.3s ease-in;
}
.agent-row-enter-from {
  opacity: 0;
  max-height: 0;
  transform: translateY(-4px);
}
.agent-row-leave-to {
  opacity: 0;
  max-height: 0;
  transform: translateY(-4px);
}

/* Log area */
.log-area {
  border-top: 1px solid var(--ea-divider);
  padding: 6px 14px;
  height: 80px;
  overflow-y: auto;
  scrollbar-width: none;
  transition: opacity 0.35s ease;
}
.log-area::-webkit-scrollbar {
  display: none;
}
.log-area.fading {
  opacity: 0;
}

.log-entries {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.log-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--ea-text-3, #888);
  animation: log-appear 0.3s ease-out;
}

@keyframes log-appear {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.log-icon {
  width: 14px;
  text-align: center;
  flex-shrink: 0;
  font-size: 10px;
}
.log-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 480px) {
  .monitor {
    font-size: 11px;
  }
  .agent-bar {
    width: 32px;
  }
  .agent-status-label {
    display: none;
  }
  .agent-row {
    padding: 4px 10px;
    gap: 6px;
  }
  .log-area {
    padding: 4px 10px;
  }
}
</style>
