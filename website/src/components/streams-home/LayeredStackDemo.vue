<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue"
import { useDemoVisibility } from "../../../.vitepress/theme/composables/useDemoVisibility"

interface Layer {
  name: string
  desc: string
  aside: string
  hint: string
  /** Form the token takes immediately AFTER passing through this layer */
  token: string
}

const LAYERS: Layer[] = [
  {
    name: "StreamDB",
    desc: "schema, queries, optimistic actions",
    aside: "← typed reactive DB · TanStack DB inside",
    hint: "Live collections with typed queries on top of MaterializedState.",
    token: 'User { id: "1", name: "Alice" }',
  },
  {
    name: "Durable State",
    desc: "insert · update · delete · snapshot",
    aside: "← typed CRUD events · MaterializedState",
    hint: "Folds the JSON event log into a typed key/value projection.",
    token: '{ type: "user", op: "insert", value: {…} }',
  },
  {
    name: "JSON mode",
    desc: "array flattening · GET → JSON array",
    aside: "← message boundaries · one POST per item",
    hint: "Each POSTed element is its own message; GET returns a JSON array.",
    token: '{"event":"click"}',
  },
  {
    name: "Electric Streams",
    desc: "PUT · POST · GET · HEAD · DELETE",
    aside: "← bytes + offsets · the base protocol",
    hint: "The HTTP wire format. Append bytes, replay from any offset.",
    token: "48 65 6c 6c 6f",
  },
]

const TOP_TOKEN = 'User { name: "Alice" }'
const BYTES_TOKEN = "{ 48 65 6c 6c 6f }"

const STEP_MS = 1100

const reduceMotion =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

const rootRef = ref<HTMLElement>()
const stackRef = ref<HTMLElement>()
const layerRefs = ref<HTMLElement[]>([])

const isVisible = useDemoVisibility(rootRef)

/** 0 = badge floating just above the first layer, 1..LAYERS.length = on layer i-1 */
const stop = ref(reduceMotion ? LAYERS.length : 0)
const hovered = ref<number | null>(null)
/** Y offset for the floating token, in px relative to .lsd-stack */
const tokenY = ref(0)

const tokenLabel = computed(() => {
  if (stop.value === 0) return TOP_TOKEN
  return LAYERS[stop.value - 1].token
})

const isAtBytes = computed(() => stop.value === LAYERS.length)

let timer: ReturnType<typeof setInterval> | null = null
let resizeObs: ResizeObserver | null = null

function recalcTokenY() {
  const stack = stackRef.value
  if (!stack) return
  const layers = layerRefs.value.filter(Boolean)
  if (layers.length === 0) return

  const stackRect = stack.getBoundingClientRect()

  if (stop.value === 0) {
    // Float just above the first layer
    const firstRect = layers[0].getBoundingClientRect()
    tokenY.value = firstRect.top - stackRect.top - 14
    return
  }

  const target = layers[Math.min(stop.value - 1, layers.length - 1)]
  if (!target) return
  const rect = target.getBoundingClientRect()
  // Center vertically on the layer
  tokenY.value = rect.top - stackRect.top + rect.height / 2 - 14
}

function setLayerRef(el: unknown, i: number) {
  if (el instanceof HTMLElement) layerRefs.value[i] = el
}

function startLoop() {
  if (reduceMotion) return
  if (timer) return
  timer = setInterval(() => {
    stop.value = (stop.value + 1) % (LAYERS.length + 1)
  }, STEP_MS)
}

function stopLoop() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

watch(stop, () => {
  recalcTokenY()
})

watch(isVisible, (v) => {
  if (v) startLoop()
  else stopLoop()
})

onMounted(async () => {
  await nextTick()
  recalcTokenY()
  if (typeof ResizeObserver !== "undefined" && stackRef.value) {
    resizeObs = new ResizeObserver(() => recalcTokenY())
    resizeObs.observe(stackRef.value)
  }
  if (isVisible.value) startLoop()
})

onUnmounted(() => {
  stopLoop()
  if (resizeObs) resizeObs.disconnect()
})

function isPulsing(i: number): boolean {
  // Layer i pulses when the badge has just landed on it (stop = i + 1)
  return stop.value === i + 1
}
</script>

<template>
  <div ref="rootRef" class="lsd" :class="{ 'lsd--reduced': reduceMotion }">
    <div class="lsd-top">
      <span class="lsd-top-label">a value enters</span>
      <code>{{ TOP_TOKEN }}</code>
    </div>

    <div class="lsd-arrow" aria-hidden="true">
      <span class="lsd-arrow-line" />
      <span class="lsd-arrow-chev">▼</span>
    </div>

    <div ref="stackRef" class="lsd-stack">
      <!-- Floating token badge that slides between stops -->
      <div
        class="lsd-token"
        :class="{ 'lsd-token--bytes': isAtBytes }"
        :style="{ transform: `translate(-50%, ${tokenY}px)` }"
        aria-hidden="true"
      >
        <code>{{ tokenLabel }}</code>
      </div>

      <template v-for="(layer, i) in LAYERS" :key="layer.name">
        <div
          class="lsd-row"
          @mouseenter="hovered = i"
          @mouseleave="hovered = null"
        >
          <div
            :ref="(el) => setLayerRef(el, i)"
            class="lsd-layer"
            :class="{
              'lsd-layer--base': i === LAYERS.length - 1,
              'lsd-layer--pulse': isPulsing(i),
              'lsd-layer--hover': hovered === i,
            }"
          >
            <div class="lsd-layer-name">{{ layer.name }}</div>
            <div class="lsd-layer-desc">{{ layer.desc }}</div>
            <div class="lsd-layer-hint">{{ layer.hint }}</div>
          </div>
          <div class="lsd-aside">{{ layer.aside }}</div>
        </div>

        <div
          v-if="i < LAYERS.length - 1"
          class="lsd-arrow lsd-arrow--inner"
          aria-hidden="true"
        >
          <span class="lsd-arrow-line" />
          <span class="lsd-arrow-chev">▼</span>
        </div>
      </template>
    </div>

    <div class="lsd-arrow" aria-hidden="true">
      <span class="lsd-arrow-line" />
      <span class="lsd-arrow-chev">▼</span>
    </div>

    <div class="lsd-bottom">
      <span class="lsd-bottom-label">bytes on the wire</span>
      <code>{{ BYTES_TOKEN }}</code>
    </div>
  </div>
</template>

<style scoped>
.lsd {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 4px 0;
  font-family: var(--vp-font-family-base);
}

/* ── Top / bottom tokens ────────────────────────────────────────────── */

.lsd-top,
.lsd-bottom {
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  background: var(--ea-surface);
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  color: var(--ea-text-1);
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
}

.lsd-top-label,
.lsd-bottom-label {
  font-size: 10.5px;
  color: var(--ea-text-2);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-family: var(--vp-font-family-base);
}

.lsd-top code,
.lsd-bottom code {
  background: var(--ea-surface-alt);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--ea-text-1);
  font-family: var(--vp-font-family-mono);
}

/* ── Arrows ─────────────────────────────────────────────────────────── */

.lsd-arrow {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 18px;
  color: var(--ea-text-2);
}

.lsd-arrow-line {
  width: 1px;
  height: 8px;
  background: var(--ea-divider);
}

.lsd-arrow-chev {
  font-size: 10px;
  line-height: 1;
  color: var(--ea-text-2);
  margin-top: 1px;
  opacity: 0.7;
}

/* ── Stack ──────────────────────────────────────────────────────────── */

.lsd-stack {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  /* Top padding leaves room for the floating badge to hover above row 1 */
  padding-top: 28px;
}

.lsd-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16px;
  align-items: center;
}

.lsd-arrow--inner {
  height: 14px;
}

/* ── Layer boxes ────────────────────────────────────────────────────── */

.lsd-layer {
  position: relative;
  width: 100%;
  max-width: 480px;
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  padding: 14px 18px;
  background: var(--ea-surface);
  transition:
    border-color 0.25s ease,
    transform 0.25s ease,
    box-shadow 0.25s ease,
    background 0.25s ease;
  z-index: 1;
}

.lsd-layer--base {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 55%, var(--ea-divider));
  background: color-mix(in srgb, var(--vp-c-brand-1) 4%, var(--ea-surface));
}

.lsd-layer--hover {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 60%, var(--ea-divider));
}

.lsd-layer--pulse {
  border-color: var(--vp-c-brand-1);
  transform: scale(1.012);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
}

.lsd-layer-name {
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  font-weight: 700;
  color: var(--ea-text-1);
  line-height: 1.2;
}

.lsd-layer--base .lsd-layer-name {
  color: var(--vp-c-brand-1);
}

.lsd-layer-desc {
  margin-top: 4px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--ea-text-2);
}

.lsd-layer-hint {
  margin-top: 8px;
  font-family: var(--vp-font-family-base);
  font-size: 12px;
  line-height: 1.45;
  color: var(--ea-text-2);
  opacity: 0;
  max-height: 0;
  overflow: hidden;
  transition: opacity 0.2s ease, max-height 0.25s ease;
}

.lsd-layer--hover .lsd-layer-hint {
  opacity: 1;
  max-height: 60px;
}

.lsd-aside {
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  color: var(--ea-text-2);
  white-space: nowrap;
}

/* ── Floating token badge ───────────────────────────────────────────── */

.lsd-token {
  position: absolute;
  left: 50%;
  top: 0;
  z-index: 5;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 50%, var(--ea-divider));
  background: color-mix(in srgb, var(--vp-c-brand-1) 14%, var(--ea-surface));
  color: var(--vp-c-brand-1);
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 1px 4px color-mix(in srgb, var(--vp-c-brand-1) 25%, transparent);
  transition:
    transform 0.55s cubic-bezier(0.65, 0.05, 0.36, 1),
    background 0.3s,
    color 0.3s,
    border-color 0.3s,
    box-shadow 0.3s;
}

.lsd-token--bytes {
  background: var(--ea-surface-alt);
  color: var(--ea-text-2);
  border-color: var(--ea-divider);
  box-shadow: none;
}

.lsd-token code {
  background: transparent;
  font: inherit;
  color: inherit;
  padding: 0;
}

.lsd--reduced .lsd-token {
  transition: none;
}

/* ── Responsive ─────────────────────────────────────────────────────── */

@media (max-width: 768px) {
  .lsd-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .lsd-aside {
    text-align: center;
    white-space: normal;
    font-size: 10.5px;
  }
  .lsd-layer {
    padding: 12px 14px;
  }
  .lsd-layer-name {
    font-size: 13px;
  }
  .lsd-layer-desc {
    font-size: 11.5px;
  }
  .lsd-token {
    font-size: 10.5px;
    padding: 4px 9px;
  }
}
</style>
