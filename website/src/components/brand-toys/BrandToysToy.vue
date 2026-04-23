<script setup lang="ts">
/* BrandToysToy — the single-toy stage page.
   ────────────────────────────────────────────
   Renders one toy from the registry inside a resizable stage with
   a right-side control drawer. All state (stage size, bg, toy
   props, panel collapsed) is mirrored to the URL query string so
   each configuration is bookmarkable. */

import {
  computed,
  defineAsyncComponent,
  markRaw,
  nextTick,
  onMounted,
  onBeforeUnmount,
  ref,
  watch,
} from "vue"

import StageFrame from "./StageFrame.vue"
import ControlPanel from "./ControlPanel.vue"
import type { ToyDef, ControlDef } from "./toys"

const props = defineProps<{
  toy: ToyDef
}>()

// ───────────── Resolve the target component ─────────────
//
// We wrap with `markRaw` so Vue doesn't try to make the component
// descriptor itself reactive. The component is lazy (dynamic import);
// `defineAsyncComponent` gives us a Suspense-friendly wrapper.
const ToyComponent = computed(() =>
  markRaw(
    defineAsyncComponent({
      loader: () => props.toy.component() as Promise<any>,
      loadingComponent: {
        render: () => null,
      },
    })
  )
)

// ───────────── URL-state helpers ─────────────

function readQuery(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

function writeQuery(mutate: (q: URLSearchParams) => void) {
  if (typeof window === "undefined") return
  const q = readQuery()
  mutate(q)
  const next = `${window.location.pathname}?${q.toString()}`
  window.history.replaceState({}, "", next)
}

// ───────────── Initial values from registry + URL ─────────────

function controlDefaults(toy: ToyDef): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const c of toy.controls ?? []) {
    if (c.default !== undefined) out[c.name] = c.default
  }
  return out
}

function parseControl(c: ControlDef, raw: string): unknown {
  switch (c.type) {
    case "boolean":
      return raw === "1" || raw === "true"
    case "number": {
      const n = parseFloat(raw)
      return Number.isFinite(n) ? n : c.default
    }
    case "multiselect":
      return raw ? raw.split(",") : []
    case "select":
    case "string":
    default:
      return raw
  }
}

function serializeControl(c: ControlDef, v: unknown): string | null {
  if (v === undefined || v === null) return null
  switch (c.type) {
    case "boolean":
      return v ? "1" : "0"
    case "multiselect":
      return Array.isArray(v) ? v.join(",") : null
    case "number":
      return String(v)
    default:
      return String(v)
  }
}

function isDefault(c: ControlDef, v: unknown): boolean {
  if (c.default === undefined) return false
  if (c.type === "multiselect") {
    return (
      Array.isArray(v) &&
      Array.isArray(c.default) &&
      v.length === (c.default as unknown[]).length &&
      v.every((x, i) => x === (c.default as unknown[])[i])
    )
  }
  return v === c.default
}

// ───────────── Reactive state ─────────────

const defaultSize = props.toy.defaultSize ?? { w: 1280, h: 720 }
// Default frame padding so the toy doesn't visually touch the chrome.
// Even hero/full-bleed scenes get a small breather here — it's the
// recording-stage view, not the live page.
const defaultPadding = 30
const width = ref(defaultSize.w)
const height = ref(defaultSize.h)
const padding = ref(defaultPadding)
const background = ref(props.toy.background ?? "dark")
const showRuler = ref(false)
const showBorder = ref(true)
const collapsed = ref(false)
const values = ref<Record<string, unknown>>(controlDefaults(props.toy))

// `mountKey` is bumped to force a fresh remount of the underlying toy
// component. Used after a resize "settles" (so canvas-sized animations
// re-measure their container) and by the manual "Remount" button.
const mountKey = ref(0)
let mounted = false
let resizeRemountTimer: ReturnType<typeof setTimeout> | null = null

function dispatchScrollSignal() {
  // Some marketing demos gate their animations on `useDemoVisibility`,
  // which only activates after the user scrolls. The composable already
  // bypasses that gate on `/brand-toys`, but a synthetic scroll event
  // also nudges any other lazy/observer-based logic into action right
  // away after a (re)mount.
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event("scroll"))
}

function remount() {
  mountKey.value += 1
  nextTick(() => dispatchScrollSignal())
}

// Special case: `filter` control with "none" option maps to `null` on
// the underlying component (see HomeIsoBg). We convert at pass-through
// time rather than storing null in the URL. Applies generally to any
// select whose "none" should mean "don't pass".
function effectiveValue(c: ControlDef, v: unknown): unknown {
  if (c.type === "select" && v === "none") return null
  return v
}

const effectiveValues = computed(() => {
  const out: Record<string, unknown> = {}
  for (const c of props.toy.controls ?? []) {
    out[c.name] = effectiveValue(c, values.value[c.name])
  }
  return { ...props.toy.staticProps, ...out }
})

// ───────────── Hydrate from URL on mount ─────────────

onMounted(() => {
  const q = readQuery()

  const w = parseInt(q.get("w") ?? "", 10)
  const h = parseInt(q.get("h") ?? "", 10)
  if (Number.isFinite(w) && w > 0) width.value = w
  if (Number.isFinite(h) && h > 0) height.value = h

  const p = parseInt(q.get("p") ?? "", 10)
  if (Number.isFinite(p) && p >= 0) padding.value = p

  const bg = q.get("bg")
  if (bg) background.value = bg
  if (q.get("ruler") === "1") showRuler.value = true
  if (q.get("border") === "0") showBorder.value = false
  if (q.get("panel") === "off") collapsed.value = true

  const next = { ...values.value }
  for (const c of props.toy.controls ?? []) {
    const raw = q.get(c.name)
    if (raw !== null) next[c.name] = parseControl(c, raw)
  }
  values.value = next

  window.addEventListener("keydown", onKey)

  // Lock body scroll while the toy stage is showing — the index page
  // wants to scroll, but the stage is a fixed-position viewport.
  if (typeof document !== "undefined") {
    document.body.classList.add("bt-toy-fixed")
  }

  mounted = true
  // Kick lazy demos that listen for scroll/IO into action.
  nextTick(() => dispatchScrollSignal())
})

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey)
  if (resizeRemountTimer) {
    clearTimeout(resizeRemountTimer)
    resizeRemountTimer = null
  }
  if (propRemountTimer) {
    clearTimeout(propRemountTimer)
    propRemountTimer = null
  }
  if (typeof document !== "undefined") {
    document.body.classList.remove("bt-toy-fixed")
    document.body.classList.remove("bt-recording")
  }
})

// Many demos size their canvas / measure their container during mount.
// When the user finishes dragging the resize handle (or types into the
// width/height inputs) we want them to re-initialise so the animation
// fits the new bounds. We debounce so we don't thrash mid-drag.
watch([width, height], () => {
  if (!mounted) return
  if (resizeRemountTimer) clearTimeout(resizeRemountTimer)
  resizeRemountTimer = setTimeout(() => {
    resizeRemountTimer = null
    mountKey.value += 1
    nextTick(() => dispatchScrollSignal())
  }, 250)
})

// Some controls are "structural" — the underlying component only
// reads them at mount / layout time (e.g. grid-cell density, node
// count caps, rail count). We watch those specific values and
// auto-remount, debounced, so dragging a slider through several
// values produces one remount at the end rather than one per tick.
let propRemountTimer: ReturnType<typeof setTimeout> | null = null
const remountPropNames = computed(() =>
  (props.toy.controls ?? [])
    .filter((c) => c.remountOnChange)
    .map((c) => c.name),
)
const remountPropValues = computed(() =>
  remountPropNames.value.map((n) => values.value[n]),
)
watch(remountPropValues, () => {
  if (!mounted) return
  if (propRemountTimer) clearTimeout(propRemountTimer)
  propRemountTimer = setTimeout(() => {
    propRemountTimer = null
    mountKey.value += 1
    nextTick(() => dispatchScrollSignal())
  }, 250)
})

// ───────────── Write state → URL ─────────────

watch(
  [width, height, padding, background, showRuler, showBorder, collapsed, values],
  () => {
    writeQuery((q) => {
      if (width.value !== defaultSize.w) q.set("w", String(width.value))
      else q.delete("w")
      if (height.value !== defaultSize.h) q.set("h", String(height.value))
      else q.delete("h")
      if (padding.value !== defaultPadding) q.set("p", String(padding.value))
      else q.delete("p")

      if (background.value !== (props.toy.background ?? "dark")) {
        q.set("bg", background.value)
      } else {
        q.delete("bg")
      }
      if (showRuler.value) q.set("ruler", "1")
      else q.delete("ruler")
      if (!showBorder.value) q.set("border", "0")
      else q.delete("border")
      if (collapsed.value) q.set("panel", "off")
      else q.delete("panel")

      for (const c of props.toy.controls ?? []) {
        const v = values.value[c.name]
        if (isDefault(c, v)) {
          q.delete(c.name)
          continue
        }
        const s = serializeControl(c, v)
        if (s === null) q.delete(c.name)
        else q.set(c.name, s)
      }
    })
  },
  { deep: true }
)

// ───────────── Keyboard shortcuts ─────────────

function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLElement) {
    const tag = e.target.tagName
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
    if (e.target.isContentEditable) return
  }
  if (e.key === "h" || e.key === "H") {
    document.body.classList.toggle("bt-recording")
  }
  if (e.key === "." || e.key === "p" || e.key === "P") {
    collapsed.value = !collapsed.value
  }
  if (e.key === "Escape") {
    window.location.href = "/brand-toys"
  }
}

// ───────────── Copy-link / reset ─────────────

const toastVisible = ref(false)
function onCopyLink() {
  if (typeof window === "undefined") return
  navigator.clipboard
    .writeText(window.location.href)
    .then(() => {
      toastVisible.value = true
      setTimeout(() => (toastVisible.value = false), 1600)
    })
    .catch(() => {
      /* no-op */
    })
}

function onReset() {
  values.value = controlDefaults(props.toy)
  width.value = defaultSize.w
  height.value = defaultSize.h
  padding.value = defaultPadding
  background.value = props.toy.background ?? "dark"
  showRuler.value = false
  showBorder.value = true
  // Force a fresh remount so the toy re-initialises against the
  // restored size / props from a clean slate.
  remount()
}

function onRemount() {
  remount()
}
</script>

<template>
  <div class="bt-toy" :class="{ 'panel-collapsed': collapsed }">
    <StageFrame
      v-model:width="width"
      v-model:height="height"
      :padding="padding"
      :background="background as any"
      :show-ruler="showRuler"
      :show-border="showBorder"
      :full-bleed="toy.fullBleed"
    >
      <Suspense :key="`mount-${mountKey}`">
        <ClientOnly v-if="toy.clientOnly">
          <component :is="ToyComponent" v-bind="effectiveValues" />
        </ClientOnly>
        <component v-else :is="ToyComponent" v-bind="effectiveValues" />

        <template #fallback>
          <div class="bt-toy-loading mono">Loading {{ toy.id }}…</div>
        </template>
      </Suspense>
    </StageFrame>

    <ControlPanel
      :toy="toy"
      :values="values"
      :width="width"
      :height="height"
      :padding="padding"
      :background="background"
      :show-ruler="showRuler"
      :show-border="showBorder"
      :collapsed="collapsed"
      @update:values="(v) => (values = v)"
      @update:width="(v) => (width = v)"
      @update:height="(v) => (height = v)"
      @update:padding="(v) => (padding = v)"
      @update:background="(v) => (background = v)"
      @update:show-ruler="(v) => (showRuler = v)"
      @update:show-border="(v) => (showBorder = v)"
      @update:collapsed="(v) => (collapsed = v)"
      @copy-link="onCopyLink"
      @reset="onReset"
      @remount="onRemount"
    />

    <transition name="bt-toast">
      <div v-if="toastVisible" class="bt-toast">Link copied to clipboard</div>
    </transition>
  </div>
</template>

<style scoped>
.bt-toy {
  position: fixed;
  inset: 0;
  background: var(--vp-c-bg, #111318);
  color: var(--vp-c-text-1, rgba(255, 255, 245, 0.92));
  display: grid;
  grid-template-columns: 1fr 320px;
  transition: grid-template-columns 0.24s ease;
}
.bt-toy.panel-collapsed {
  grid-template-columns: 1fr 0;
}

/* In recording mode, give the stage the full viewport — both the panel
   and the column it reserved are gone. Wrapped fully in `:global(...)` so
   Vue's scoped-CSS compiler doesn't mangle the selector. */
:global(body.bt-recording .bt-toy) {
  grid-template-columns: 1fr 0 !important;
}

.bt-toy-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
}

.bt-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 16px;
  background: rgba(56, 189, 248, 0.9);
  color: #02121f;
  font-size: 13px;
  font-weight: 600;
  border-radius: 6px;
  z-index: 200;
}

.bt-toast-enter-active,
.bt-toast-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.bt-toast-enter-from,
.bt-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

.mono {
  font-family: var(--vp-font-family-mono, ui-monospace, monospace);
}
</style>
