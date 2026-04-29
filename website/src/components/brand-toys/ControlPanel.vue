<script setup lang="ts">
/* ControlPanel — right-side collapsible drawer for brand-toys.
   ─────────────────────────────────────────────────────────────
   Sections:
     · Stage       — width / height numeric, size preset dropdown,
                     bg preset, ruler & border toggles, "Copy link".
     · Toy         — props rendered from the toy's `controls` schema.

   The panel is a slim pinned drawer on the right side of the
   viewport. The whole panel hides via `body.bt-recording` so you
   can capture a clean shot with a single keypress.  */

import { computed } from 'vue'

import type { ToyDef } from './toys'
import { GROUP_LABELS } from './toys'

const props = defineProps<{
  toy: ToyDef
  /** Current prop values for the toy (name → value). */
  values: Record<string, unknown>
  /** Current stage dimensions. */
  width: number
  height: number
  /** Padding around the stage frame (CSS px). */
  padding: number
  /** Stage background preset. */
  background: string
  /** Toggle flags. */
  showRuler: boolean
  showBorder: boolean
  /** Collapsed (fully off-screen) */
  collapsed: boolean
}>()

const emit = defineEmits<{
  (e: 'update:values', values: Record<string, unknown>): void
  (e: 'update:width', w: number): void
  (e: 'update:height', h: number): void
  (e: 'update:padding', p: number): void
  (e: 'update:background', v: string): void
  (e: 'update:showRuler', v: boolean): void
  (e: 'update:showBorder', v: boolean): void
  (e: 'update:collapsed', v: boolean): void
  (e: 'copy-link'): void
  (e: 'reset'): void
  (e: 'remount'): void
}>()

interface SizePreset {
  label: string
  w: number
  h: number
}
const SIZE_PRESETS: SizePreset[] = [
  { label: '1920 × 1080 — FHD landscape', w: 1920, h: 1080 },
  { label: '1280 × 720 — HD landscape', w: 1280, h: 720 },
  { label: '1600 × 900 — 16:9 widescreen', w: 1600, h: 900 },
  { label: '1080 × 1080 — square (social)', w: 1080, h: 1080 },
  { label: '1080 × 1350 — portrait (social)', w: 1080, h: 1350 },
  { label: '1200 × 630 — OG card', w: 1200, h: 630 },
  { label: '2400 × 1260 — OG @2x', w: 2400, h: 1260 },
  { label: '1440 × 900 — desktop', w: 1440, h: 900 },
  { label: '375 × 812 — mobile', w: 375, h: 812 },
]

const BG_PRESETS: { id: string; label: string }[] = [
  { id: 'dark', label: 'Dark — page (#111318)' },
  { id: 'surface', label: 'Surface — soft (#16181f)' },
  { id: 'elv', label: 'Elevated — card (#22252f)' },
  { id: 'light', label: 'Light (#f5f5f5)' },
  { id: 'white', label: 'White' },
  { id: 'black', label: 'Black' },
  { id: 'transparent', label: 'Transparent (checker)' },
]

const presetValue = computed(() => {
  const match = SIZE_PRESETS.find(
    (p) => p.w === props.width && p.h === props.height
  )
  return match ? `${match.w}x${match.h}` : 'custom'
})

function applyPreset(v: string) {
  if (v === 'custom') return
  const [w, h] = v.split('x').map((n) => parseInt(n, 10))
  if (Number.isFinite(w)) emit('update:width', w)
  if (Number.isFinite(h)) emit('update:height', h)
}

function setValue(name: string, v: unknown) {
  emit('update:values', { ...props.values, [name]: v })
}

function isMultiSelected(name: string, opt: string) {
  const cur = props.values[name]
  return Array.isArray(cur) && (cur as string[]).includes(opt)
}

function toggleMulti(name: string, opt: string) {
  const cur = props.values[name]
  const arr = Array.isArray(cur) ? [...(cur as string[])] : []
  const i = arr.indexOf(opt)
  if (i === -1) arr.push(opt)
  else arr.splice(i, 1)
  setValue(name, arr)
}

const groupLabel = computed(() => GROUP_LABELS[props.toy.group])
</script>

<template>
  <aside class="bt-panel" :class="{ collapsed }">
    <button
      type="button"
      class="bt-panel-toggle"
      :title="collapsed ? 'Show controls' : 'Hide controls'"
      @click="emit('update:collapsed', !collapsed)"
    >
      <span v-if="collapsed">‹</span>
      <span v-else>›</span>
    </button>

    <div class="bt-panel-inner">
      <header class="bt-panel-head">
        <div class="bt-head-eyebrow mono">{{ groupLabel }}</div>
        <h2 class="bt-head-title">{{ toy.label }}</h2>
        <p v-if="toy.description" class="bt-head-desc">{{ toy.description }}</p>
        <div class="bt-head-actions">
          <a class="bt-head-link mono" href="/brand-toys">← All toys</a>
          <a
            class="bt-head-link mono"
            :href="`https://github.com/electric-sql/electric/blob/main/website/${toy.source}`"
            target="_blank"
            rel="noopener"
            >source ↗</a
          >
        </div>
      </header>

      <!-- ──────────────── Stage ──────────────── -->
      <section class="bt-section">
        <h3 class="bt-section-title">Stage</h3>

        <label class="bt-field">
          <span>Size preset</span>
          <select
            :value="presetValue"
            @change="applyPreset(($event.target as HTMLSelectElement).value)"
          >
            <option value="custom">Custom…</option>
            <option
              v-for="p in SIZE_PRESETS"
              :key="`${p.w}x${p.h}`"
              :value="`${p.w}x${p.h}`"
            >
              {{ p.label }}
            </option>
          </select>
        </label>

        <div class="bt-field-row">
          <label class="bt-field">
            <span>Width</span>
            <input
              type="number"
              :value="width"
              min="80"
              step="1"
              @change="
                emit(
                  'update:width',
                  parseInt(($event.target as HTMLInputElement).value, 10) ||
                    width
                )
              "
            />
          </label>
          <label class="bt-field">
            <span>Height</span>
            <input
              type="number"
              :value="height"
              min="60"
              step="1"
              @change="
                emit(
                  'update:height',
                  parseInt(($event.target as HTMLInputElement).value, 10) ||
                    height
                )
              "
            />
          </label>
        </div>

        <label class="bt-field">
          <span>Padding (px)</span>
          <input
            type="number"
            :value="padding"
            min="0"
            max="320"
            step="2"
            @change="
              emit(
                'update:padding',
                Math.max(
                  0,
                  parseInt(($event.target as HTMLInputElement).value, 10) || 0
                )
              )
            "
          />
        </label>

        <label class="bt-field">
          <span>Background</span>
          <select
            :value="background"
            @change="
              emit(
                'update:background',
                ($event.target as HTMLSelectElement).value
              )
            "
          >
            <option v-for="b in BG_PRESETS" :key="b.id" :value="b.id">
              {{ b.label }}
            </option>
          </select>
        </label>

        <label class="bt-check">
          <input
            type="checkbox"
            :checked="showBorder"
            @change="
              emit(
                'update:showBorder',
                ($event.target as HTMLInputElement).checked
              )
            "
          />
          <span>Show frame border</span>
        </label>
        <label class="bt-check">
          <input
            type="checkbox"
            :checked="showRuler"
            @change="
              emit(
                'update:showRuler',
                ($event.target as HTMLInputElement).checked
              )
            "
          />
          <span>Show ruler ticks</span>
        </label>

        <div class="bt-btn-row">
          <button
            type="button"
            class="bt-btn primary"
            title="Force a fresh remount of the toy (also fires automatically when you stop resizing)"
            @click="emit('remount')"
          >
            Remount
          </button>
          <button
            type="button"
            class="bt-btn"
            title="Restore the default size, padding, background and props"
            @click="emit('reset')"
          >
            Reset
          </button>
        </div>
        <div class="bt-btn-row">
          <button type="button" class="bt-btn" @click="emit('copy-link')">
            Copy link
          </button>
        </div>
        <p class="bt-hint mono">
          Press <kbd>H</kbd> to hide all chrome for recording.
        </p>
      </section>

      <!-- ──────────────── Toy controls ──────────────── -->
      <section v-if="toy.controls && toy.controls.length" class="bt-section">
        <h3 class="bt-section-title">Props</h3>

        <template v-for="c in toy.controls" :key="c.name">
          <!-- Boolean -->
          <label v-if="c.type === 'boolean'" class="bt-check">
            <input
              type="checkbox"
              :checked="!!values[c.name]"
              @change="
                setValue(c.name, ($event.target as HTMLInputElement).checked)
              "
            />
            <span>
              {{ c.label ?? c.name }}
              <em v-if="c.description" class="bt-hint-inline">{{
                c.description
              }}</em>
            </span>
          </label>

          <!-- Select -->
          <label v-else-if="c.type === 'select'" class="bt-field">
            <span>{{ c.label ?? c.name }}</span>
            <select
              :value="values[c.name] as string"
              @change="
                setValue(c.name, ($event.target as HTMLSelectElement).value)
              "
            >
              <option v-for="o in c.options" :key="o" :value="o">
                {{ o }}
              </option>
            </select>
            <em v-if="c.description" class="bt-hint-inline">{{
              c.description
            }}</em>
          </label>

          <!-- Multi-select -->
          <div v-else-if="c.type === 'multiselect'" class="bt-multi">
            <span class="bt-multi-label">{{ c.label ?? c.name }}</span>
            <div class="bt-chip-row">
              <button
                v-for="o in c.options"
                :key="o"
                type="button"
                class="bt-chip"
                :class="{ active: isMultiSelected(c.name, o) }"
                @click="toggleMulti(c.name, o)"
              >
                {{ o }}
              </button>
            </div>
            <em v-if="c.description" class="bt-hint-inline">{{
              c.description
            }}</em>
          </div>

          <!-- Number — renders an extra range slider above the
               numeric input when both min and max are defined, so
               density / activity / speed multipliers can be
               scrubbed live while still allowing precise typed
               values. The slider and the number input are bound to
               the same value via `setValue`. -->
          <label v-else-if="c.type === 'number'" class="bt-field">
            <span class="bt-num-row">
              <span>{{ c.label ?? c.name }}</span>
              <span class="bt-num-readout">{{ values[c.name] }}</span>
            </span>
            <input
              v-if="c.min !== undefined && c.max !== undefined"
              type="range"
              class="bt-range"
              :value="values[c.name] as number"
              :min="c.min"
              :max="c.max"
              :step="c.step ?? 1"
              @input="
                setValue(
                  c.name,
                  parseFloat(($event.target as HTMLInputElement).value)
                )
              "
            />
            <input
              type="number"
              :value="values[c.name] as number"
              :min="c.min"
              :max="c.max"
              :step="c.step ?? 1"
              @change="
                setValue(
                  c.name,
                  parseFloat(($event.target as HTMLInputElement).value)
                )
              "
            />
            <em v-if="c.description" class="bt-hint-inline">{{
              c.description
            }}</em>
          </label>

          <!-- String -->
          <label v-else-if="c.type === 'string'" class="bt-field">
            <span>{{ c.label ?? c.name }}</span>
            <input
              type="text"
              :value="values[c.name] as string"
              @change="
                setValue(c.name, ($event.target as HTMLInputElement).value)
              "
            />
            <em v-if="c.description" class="bt-hint-inline">{{
              c.description
            }}</em>
          </label>
        </template>
      </section>

      <section v-else class="bt-section">
        <h3 class="bt-section-title">Props</h3>
        <p class="bt-empty">This toy has no exposed controls.</p>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.bt-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 320px;
  background: var(--vp-c-bg-soft, #16181f);
  border-left: 1px solid var(--vp-c-divider, #2a2d38);
  color: var(--vp-c-text-1, rgba(255, 255, 245, 0.92));
  font-size: 13px;
  font-family: var(--vp-font-family-base, system-ui, sans-serif);
  z-index: 100;
  transition: transform 0.24s ease;
  display: flex;
  flex-direction: column;
}

.bt-panel.collapsed {
  transform: translateX(320px);
}

.bt-panel-toggle {
  position: absolute;
  top: 50%;
  left: -24px;
  transform: translateY(-50%);
  width: 24px;
  height: 48px;
  background: var(--vp-c-bg-soft, #16181f);
  color: var(--vp-c-text-1, rgba(255, 255, 245, 0.92));
  border: 1px solid var(--vp-c-divider, #2a2d38);
  border-right: none;
  border-radius: 6px 0 0 6px;
  font-family: var(--vp-font-family-mono, ui-monospace, monospace);
  font-size: 14px;
  cursor: pointer;
}
.bt-panel-toggle:hover {
  background: var(--vp-c-bg-elv, #22252f);
}

.bt-panel-inner {
  overflow-y: auto;
  padding: 18px 20px 40px;
  flex: 1;
}

.bt-panel-head {
  padding-bottom: 16px;
  border-bottom: 1px solid var(--vp-c-divider, #2a2d38);
  margin-bottom: 16px;
}
.bt-head-eyebrow {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-text-3, rgba(235, 235, 245, 0.55));
}
.bt-head-title {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.25;
  margin: 4px 0 6px;
  color: var(--vp-c-text-1, rgba(255, 255, 245, 0.92));
}
.bt-head-desc {
  font-size: 12px;
  color: var(--vp-c-text-2, rgba(235, 235, 245, 0.78));
  margin: 0 0 10px;
  line-height: 1.4;
}
.bt-head-actions {
  display: flex;
  gap: 12px;
  font-size: 11px;
}
.bt-head-link {
  color: var(--vp-c-brand-1, #75fbfd);
  text-decoration: none;
}
.bt-head-link:hover {
  color: var(--vp-c-brand-2, #b8fdfe);
}

.bt-section {
  padding-bottom: 20px;
  border-bottom: 1px solid var(--vp-c-divider, #2a2d38);
  margin-bottom: 20px;
}
.bt-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
}
.bt-section-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-text-3, rgba(235, 235, 245, 0.55));
  margin: 0 0 12px;
}

.bt-field,
.bt-multi {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  /* Grid/flex children with form elements inside need `min-width: 0`
     so the parent track can shrink below the input's intrinsic
     `size` attribute width — otherwise the second column of
     `bt-field-row` (Height) overflows the 320px panel. */
  min-width: 0;
}
.bt-field > span,
.bt-multi-label {
  font-size: 12px;
  color: var(--vp-c-text-2, rgba(235, 235, 245, 0.78));
}
.bt-field input,
.bt-field select {
  /* `width: 100%` + `box-sizing: border-box` so the input fills its
     grid/flex cell exactly, instead of using the default ~170px
     `size` attribute width that overflows the panel. */
  width: 100%;
  box-sizing: border-box;
  background: var(--vp-c-bg, #111318);
  border: 1px solid var(--vp-c-divider, #2a2d38);
  color: var(--vp-c-text-1, rgba(255, 255, 245, 0.92));
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 13px;
  font-family: inherit;
}
.bt-field input[type='number'] {
  font-family: var(--vp-font-family-mono, ui-monospace, monospace);
}

/* Number control with min/max gets a slider above the typed input.
   The label sits in a row with the live numeric value on the right
   so you can see what the slider is doing without taking your eye
   off the canvas. */
.bt-num-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.bt-num-readout {
  font-family: var(--vp-font-family-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--vp-c-text-1, rgba(255, 255, 245, 0.92));
  background: var(--vp-c-bg, #111318);
  border: 1px solid var(--vp-c-divider, #2a2d38);
  border-radius: 3px;
  padding: 1px 5px;
  min-width: 28px;
  text-align: right;
}
.bt-field input.bt-range[type='range'] {
  /* Override the generic `.bt-field input` background/border/padding
     — range inputs render a track + thumb chrome and need to be
     left to the browser styling for legibility. */
  background: transparent;
  border: 0;
  padding: 0;
  margin: 0;
  height: 18px;
  accent-color: var(--vp-c-brand-1, #00d2be);
  width: 100%;
  box-sizing: border-box;
}

.bt-field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.bt-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: var(--vp-c-text-1, rgba(255, 255, 245, 0.92));
  margin-bottom: 10px;
  line-height: 1.4;
}
.bt-check input {
  margin-top: 2px;
}

.bt-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.bt-chip {
  background: var(--vp-c-bg, #111318);
  border: 1px solid var(--vp-c-divider, #2a2d38);
  color: var(--vp-c-text-2, rgba(235, 235, 245, 0.78));
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11px;
  cursor: pointer;
}
.bt-chip.active {
  background: var(--vp-c-brand-soft, rgba(117, 251, 253, 0.16));
  border-color: var(--vp-c-brand-1, #75fbfd);
  color: var(--vp-c-text-1, rgba(255, 255, 245, 0.92));
}

.bt-btn-row {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.bt-btn {
  flex: 1;
  padding: 6px 10px;
  background: var(--vp-c-bg, #111318);
  border: 1px solid var(--vp-c-divider, #2a2d38);
  color: var(--vp-c-text-1, rgba(255, 255, 245, 0.92));
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.bt-btn:hover {
  background: var(--vp-c-bg-elv, #22252f);
}
.bt-btn.primary {
  background: var(--vp-c-brand-soft, rgba(117, 251, 253, 0.16));
  border-color: var(--vp-c-brand-1, #75fbfd);
}
.bt-btn.primary:hover {
  background: var(--vp-c-brand-1, #75fbfd);
  color: var(--vp-button-brand-text, #1a1a1a);
}

.bt-hint {
  margin-top: 10px;
  font-size: 11px;
  color: var(--vp-c-text-3, rgba(235, 235, 245, 0.55));
}
.bt-hint kbd {
  background: var(--vp-c-bg-elv, #22252f);
  border: 1px solid var(--vp-c-divider, #2a2d38);
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 10px;
  font-family: var(--vp-font-family-mono, ui-monospace, monospace);
  color: var(--vp-c-text-1, rgba(255, 255, 245, 0.92));
}
.bt-hint-inline {
  display: block;
  font-size: 11px;
  color: var(--vp-c-text-3, rgba(235, 235, 245, 0.55));
  font-style: normal;
  line-height: 1.4;
  margin-top: 2px;
}

.bt-empty {
  font-size: 12px;
  color: var(--vp-c-text-3, rgba(235, 235, 245, 0.55));
  margin: 0;
}

.mono {
  font-family: var(--vp-font-family-mono, ui-monospace, monospace);
}

/* Hide panel entirely when body is in recording mode. We wrap the full
   selector in a single `:global(...)` to avoid a Vue scoped-CSS quirk
   where comma-separated `:global(parent) .child` selectors can compile to
   a rule that matches the parent itself (e.g. `body.bt-recording`),
   collapsing the page. See StageFrame.vue for the same fix.

   `display: none` (rather than just transform) so the little expose-handle
   that lives outside the panel goes away too. */
:global(body.bt-recording .bt-panel) {
  display: none !important;
}
</style>
