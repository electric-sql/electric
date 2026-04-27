<script setup lang="ts">
import { reactive, ref, watch, onUnmounted } from "vue"
import EntityNode from "./EntityNode.vue"
import { useDemoVisibility } from "../../../.vitepress/theme/composables/useDemoVisibility"

const rootRef = ref<HTMLElement>()
const isVisible = useDemoVisibility(rootRef)
let cycleId = 0
const timers: ReturnType<typeof setTimeout>[] = []

function clearTimers() {
  timers.forEach(clearTimeout)
  timers.length = 0
}

type Step = { d: number; fn: () => void }

type EntityStatus = "active" | "idle" | "sleeping" | "crashed" | "busy"

const spawn = reactive<{
  planner: EntityStatus
  researcher: EntityStatus
  writer: EntityStatus
  pr: { active: boolean; label: string; reverse: boolean }
  pw: { active: boolean; label: string; reverse: boolean }
}>({
  planner: "sleeping",
  researcher: "sleeping",
  writer: "sleeping",
  pr: { active: false, label: "", reverse: false },
  pw: { active: false, label: "", reverse: false },
})

function resetSpawn() {
  spawn.planner = "sleeping"
  spawn.researcher = "sleeping"
  spawn.writer = "sleeping"
  spawn.pr = { active: false, label: "", reverse: false }
  spawn.pw = { active: false, label: "", reverse: false }
}

const observe = reactive<{
  monitor: EntityStatus
  worker: EntityStatus
  active: boolean
  label: string
  dots: boolean
}>({
  monitor: "sleeping",
  worker: "sleeping",
  active: false,
  label: "",
  dots: false,
})

function resetObserve() {
  observe.monitor = "sleeping"
  observe.worker = "sleeping"
  observe.active = false
  observe.label = ""
  observe.dots = false
}

const shared = reactive<{
  a1: EntityStatus
  a2: EntityStatus
  a3: EntityStatus
  pulse: boolean
  l1: { active: boolean; label: string }
  l2: { active: boolean; label: string }
  l3: { active: boolean; label: string }
}>({
  a1: "sleeping",
  a2: "sleeping",
  a3: "sleeping",
  pulse: false,
  l1: { active: false, label: "" },
  l2: { active: false, label: "" },
  l3: { active: false, label: "" },
})

function resetShared() {
  shared.a1 = "sleeping"
  shared.a2 = "sleeping"
  shared.a3 = "sleeping"
  shared.pulse = false
  shared.l1 = { active: false, label: "" }
  shared.l2 = { active: false, label: "" }
  shared.l3 = { active: false, label: "" }
}

const SPAWN_STEPS: Step[] = [
  { d: 0, fn: resetSpawn },
  { d: 500, fn() { spawn.planner = "active" } },
  { d: 1100, fn() { spawn.pr = { active: true, label: "spawn", reverse: false } } },
  { d: 1600, fn() { spawn.researcher = "sleeping"; spawn.pr = { active: false, label: "", reverse: false } } },
  { d: 2200, fn() { spawn.pw = { active: true, label: "spawn", reverse: false } } },
  { d: 2700, fn() { spawn.writer = "sleeping"; spawn.pw = { active: false, label: "", reverse: false } } },
  { d: 3300, fn() { spawn.pr = { active: true, label: "send", reverse: false } } },
  { d: 3800, fn() { spawn.researcher = "active"; spawn.pr = { active: false, label: "", reverse: false } } },
  { d: 4400, fn() { spawn.pr = { active: true, label: "results", reverse: true } } },
  { d: 5000, fn() { spawn.pr = { active: false, label: "", reverse: false }; spawn.pw = { active: true, label: "send", reverse: false } } },
  { d: 5500, fn() { spawn.writer = "active"; spawn.pw = { active: false, label: "", reverse: false } } },
  { d: 6100, fn() { spawn.pw = { active: true, label: "draft ready", reverse: true } } },
  { d: 6900, fn: resetSpawn },
]

const OBSERVE_STEPS: Step[] = [
  { d: 0, fn: resetObserve },
  { d: 500, fn() { observe.monitor = "active"; observe.active = true; observe.label = "observe" } },
  { d: 1300, fn() { observe.worker = "active"; observe.label = "events"; observe.dots = true } },
  { d: 4300, fn() { observe.worker = "sleeping"; observe.dots = false; observe.label = "completed" } },
  { d: 5500, fn: resetObserve },
]

const SHARED_STEPS: Step[] = [
  { d: 0, fn: resetShared },
  { d: 500, fn() { shared.a1 = "active"; shared.l1 = { active: true, label: "write" } } },
  { d: 1100, fn() { shared.a2 = "active"; shared.a3 = "active"; shared.l2 = { active: true, label: "read" }; shared.l3 = { active: true, label: "read" } } },
  { d: 1900, fn() { shared.pulse = true } },
  { d: 2300, fn() { shared.pulse = false; shared.l1 = { active: false, label: "" }; shared.l2 = { active: true, label: "sync" }; shared.l3 = { active: true, label: "sync" } } },
  { d: 3100, fn() { shared.l2 = { active: true, label: "write" }; shared.l3 = { active: false, label: "" }; shared.pulse = true } },
  { d: 3500, fn() { shared.pulse = false; shared.l1 = { active: true, label: "sync" }; shared.l2 = { active: false, label: "" }; shared.l3 = { active: true, label: "sync" } } },
  { d: 4500, fn: resetShared },
]

const CYCLE_MS = 8500

function scheduleSteps(steps: Step[], id: number) {
  for (const s of steps) {
    timers.push(setTimeout(() => { if (cycleId === id) s.fn() }, s.d))
  }
}

function runCycle(id: number) {
  if (cycleId !== id || !isVisible.value) return
  scheduleSteps(SPAWN_STEPS, id)
  scheduleSteps(OBSERVE_STEPS, id)
  scheduleSteps(SHARED_STEPS, id)
  timers.push(setTimeout(() => { if (cycleId === id) runCycle(id) }, CYCLE_MS))
}

function restart() {
  clearTimers()
  resetSpawn()
  resetObserve()
  resetShared()
  cycleId++
  runCycle(cycleId)
}

watch(isVisible, (v) => {
  if (v) restart()
  else clearTimers()
})

onUnmounted(() => {
  clearTimers()
  cycleId = -1
})
</script>

<template>
  <div ref="rootRef" class="coord-demo">
    <div class="tiles">
      <!-- Spawn & Send -->
      <div class="tile">
        <h3 class="tile-title">Spawn &amp; Send</h3>
        <p class="tile-desc"><code>spawn</code> creates a new entity. <code>send</code> delivers a message to any entity — waking it if it's sleeping. The entity replays from its stream, handles the message, then scales back to zero.</p>
        <div class="diagram md-exclude">
          <svg class="diagram-svg" viewBox="0 0 300 200">
            <line x1="66" y1="100" x2="225" y2="44" :class="['conn', { active: spawn.pr.active }]" />
            <line x1="66" y1="100" x2="225" y2="156" :class="['conn', { active: spawn.pw.active }]" />
          </svg>
          <div v-if="spawn.pr.active" :key="'pr-' + spawn.pr.label" class="dot" :class="spawn.pr.reverse ? 'dot-from-r' : 'dot-to-r'" />
          <div v-if="spawn.pw.active" :key="'pw-' + spawn.pw.label" class="dot" :class="spawn.pw.reverse ? 'dot-from-w' : 'dot-to-w'" />
          <span v-if="spawn.pr.label" class="line-label" style="left: 48%; top: 28%">{{ spawn.pr.label }}</span>
          <span v-if="spawn.pw.label" class="line-label" style="left: 48%; top: 72%">{{ spawn.pw.label }}</span>
          <EntityNode name="planner" :status="spawn.planner" compact class="node" style="left: 22%; top: 50%" />
          <EntityNode name="researcher" :status="spawn.researcher" compact class="node" style="left: 75%; top: 22%" />
          <EntityNode name="writer" :status="spawn.writer" compact class="node" style="left: 75%; top: 78%" />
        </div>
        <pre class="tile-code"><code><span class="tk-comment">// create new entities</span>
<span class="tk-kw">await</span> <span class="tk-v">ctx</span>.<span class="tk-fn">spawn</span>(<span class="tk-str">"researcher"</span>, <span class="tk-str">"r1"</span>)
<span class="tk-kw">await</span> <span class="tk-v">ctx</span>.<span class="tk-fn">spawn</span>(<span class="tk-str">"writer"</span>, <span class="tk-str">"w1"</span>)

<span class="tk-comment">// send wakes them with a message</span>
<span class="tk-v">ctx</span>.<span class="tk-fn">send</span>(<span class="tk-str">"/researcher/r1"</span>, {
  <span class="tk-prop">task</span>: <span class="tk-str">"search for X"</span>
})</code></pre>
      </div>

      <!-- Observe -->
      <div class="tile">
        <h3 class="tile-title">Observe</h3>
        <p class="tile-desc">Watch another entity's stream in real time. When the observed entity appends an event, the observer wakes to process it — no polling, no open connections while&nbsp;idle.</p>
        <div class="diagram md-exclude">
          <svg class="diagram-svg" viewBox="0 0 300 200">
            <line x1="75" y1="100" x2="225" y2="100" :class="['conn', { active: observe.active }]" />
          </svg>
          <template v-if="observe.dots">
            <div v-for="i in 4" :key="i" class="dot dot-observe" :style="{ animationDelay: `${(i - 1) * 0.3}s` }" />
          </template>
          <span v-if="observe.label" class="line-label" style="left: 50%; top: 38%">{{ observe.label }}</span>
          <EntityNode name="monitor" :status="observe.monitor" compact class="node" style="left: 25%; top: 50%" />
          <EntityNode name="worker" :status="observe.worker" compact class="node" style="left: 75%; top: 50%" />
        </div>
        <pre class="tile-code"><code><span class="tk-kw">await</span> <span class="tk-v">ctx</span>.<span class="tk-fn">observe</span>(
  <span class="tk-fn">entity</span>(<span class="tk-str">"/worker/task-1"</span>),
  { <span class="tk-prop">wake</span>: <span class="tk-str">"runFinished"</span> }
)

<span class="tk-comment">// handler re-invoked when worker finishes</span>
<span class="tk-kw">const</span> <span class="tk-v">result</span> = <span class="tk-v">wake</span>.<span class="tk-v">payload</span></code></pre>
      </div>

      <!-- Shared State -->
      <div class="tile">
        <h3 class="tile-title">Shared State</h3>
        <p class="tile-desc">Multiple entities read and write to a shared state object backed by a stream. Changes propagate automatically — each writer wakes readers when state&nbsp;updates.</p>
        <div class="diagram md-exclude">
          <svg class="diagram-svg" viewBox="0 0 300 200">
            <line x1="150" y1="28" x2="150" y2="80" :class="['conn', { active: shared.l1.active }]" />
            <line x1="75" y1="166" x2="138" y2="108" :class="['conn', { active: shared.l2.active }]" />
            <line x1="225" y1="166" x2="162" y2="108" :class="['conn', { active: shared.l3.active }]" />
            <rect x="134" y="82" width="32" height="28" rx="4" :class="['state-box', { pulse: shared.pulse }]" />
            <line x1="140" y1="90" x2="160" y2="90" class="state-line" />
            <line x1="140" y1="96" x2="160" y2="96" class="state-line" />
            <line x1="140" y1="102" x2="155" y2="102" class="state-line" />
          </svg>
          <span v-if="shared.l1.label" class="line-label" style="left: 56%; top: 28%">{{ shared.l1.label }}</span>
          <span v-if="shared.l2.label" class="line-label" style="left: 28%; top: 66%">{{ shared.l2.label }}</span>
          <span v-if="shared.l3.label" class="line-label" style="left: 68%; top: 66%">{{ shared.l3.label }}</span>
          <EntityNode name="writer" :status="shared.a1" compact class="node" style="left: 50%; top: 14%" />
          <EntityNode name="reader-a" :status="shared.a2" compact class="node" style="left: 25%; top: 83%" />
          <EntityNode name="reader-b" :status="shared.a3" compact class="node" style="left: 75%; top: 83%" />
        </div>
        <pre class="tile-code"><code><span class="tk-kw">const</span> <span class="tk-v">state</span> =
  <span class="tk-v">ctx</span>.<span class="tk-fn">createSharedState</span>(<span class="tk-str">"research"</span>, <span class="tk-v">schema</span>)

<span class="tk-comment">// other entities:</span>
<span class="tk-kw">const</span> <span class="tk-v">view</span> =
  <span class="tk-v">ctx</span>.<span class="tk-fn">connectSharedState</span>(<span class="tk-str">"research"</span>, <span class="tk-v">schema</span>)</code></pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tiles {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.tile {
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  background: var(--ea-surface);
  overflow: visible;
  display: flex;
  flex-direction: column;
}

.tile-title {
  margin: 0;
  padding: 16px 20px 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--ea-text-1);
}

.tile-desc {
  margin: 0;
  padding: 8px 20px 12px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--ea-text-2);
}

/* ── Diagram ─────────────────────────────────────────────────────────── */

.diagram {
  position: relative;
  aspect-ratio: 300 / 200;
  padding: 8px 12px;
}

.diagram-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.node {
  position: absolute;
  transform: translate(-50%, -50%);
  z-index: 5;
}

/* ── Code ────────────────────────────────────────────────────────────── */

.tile-code {
  margin: 0;
  padding: 12px 20px;
  background: var(--ea-surface-alt);
  border-top: 1px solid var(--ea-divider);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  line-height: 1.65;
  color: var(--ea-text-2);
  overflow-x: auto;
  white-space: pre;
  flex: 1;
}

/* ── SVG lines ───────────────────────────────────────────────────────── */

.conn {
  stroke: var(--ea-divider);
  stroke-width: 1.5;
  fill: none;
  transition: stroke 0.3s;
  vector-effect: non-scaling-stroke;
}

.conn.active {
  stroke: var(--ea-indicator-active);
}

/* ── State icon ──────────────────────────────────────────────────────── */

.state-box {
  fill: var(--ea-surface-alt);
  stroke: var(--ea-divider);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
  transition: stroke 0.3s, filter 0.3s;
}

.state-box.pulse {
  stroke: var(--ea-indicator-active);
  filter: drop-shadow(0 0 6px var(--ea-indicator-active));
}

.state-line {
  stroke: var(--ea-text-2);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  opacity: 0.35;
}

/* ── Traveling dots ──────────────────────────────────────────────────── */

.dot {
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ea-indicator-active);
  box-shadow: 0 0 5px var(--ea-indicator-active);
  z-index: 3;
  pointer-events: none;
  transform: translate(-50%, -50%);
}

.dot-to-r { animation: to-r 0.55s ease-out forwards; }
.dot-from-r { animation: from-r 0.55s ease-out forwards; }
.dot-to-w { animation: to-w 0.55s ease-out forwards; }
.dot-from-w { animation: from-w 0.55s ease-out forwards; }
.dot-observe { animation: obs 1.2s linear infinite both; left: 75%; top: 50%; }

@keyframes to-r { from { left: 22%; top: 50%; } to { left: 75%; top: 22%; } }
@keyframes from-r { from { left: 75%; top: 22%; } to { left: 22%; top: 50%; } }
@keyframes to-w { from { left: 22%; top: 50%; } to { left: 75%; top: 78%; } }
@keyframes from-w { from { left: 75%; top: 78%; } to { left: 22%; top: 50%; } }
@keyframes obs { from { left: 75%; top: 50%; opacity: 1; } to { left: 25%; top: 50%; opacity: 0; } }

/* ── Line labels ─────────────────────────────────────────────────────── */

.line-label {
  position: absolute;
  transform: translate(-50%, -50%);
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  color: var(--ea-text-2);
  padding: 1px 5px;
  white-space: nowrap;
  z-index: 4;
  pointer-events: none;
}

/* ── Syntax tokens ───────────────────────────────────────────────────── */

.tile-code :deep(.tk-kw) { color: var(--vp-c-brand-1); }
.tile-code :deep(.tk-fn) { color: var(--ea-event-message); }
.tile-code :deep(.tk-str) { color: var(--ea-event-tool-result); }
.tile-code :deep(.tk-prop) { color: var(--ea-event-tool-call); }
.tile-code :deep(.tk-v) { color: var(--ea-text-1); }
.tile-code :deep(.tk-comment) { color: var(--ea-text-2); opacity: 0.6; font-style: italic; }

/* ── Responsive ──────────────────────────────────────────────────────── */

@media (max-width: 900px) {
  .tiles {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 480px) {
  .tiles {
    gap: 12px;
  }
  .tile-title {
    font-size: 14px;
    padding: 12px 14px 0;
  }
  .tile-desc {
    font-size: 12.5px;
    padding: 6px 14px 10px;
  }
  .tile-code {
    font-size: 11px;
    padding: 10px 14px;
  }
  .line-label {
    font-size: 9px;
  }
}
</style>
