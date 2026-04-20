<script setup lang="ts">
/**
 * HomeIsoLegend — interactive substrate filter for the homepage hero.
 *
 * Three pills (sync / streams / agents). Click model (per v2 plan):
 *   - first click on a pill   → activate filter (others dim).
 *   - click on the active pill → deactivate (return to all-bright).
 *   - click on a different pill → switch active filter.
 *   - hover                   → temporary highlight (leaves the
 *                                "active" filter alone).
 *
 * Each pill carries a substrate-coloured glyph (mini-icon) so the
 * choice doesn't depend on colour alone — the v2 plan calls for
 * shape-encoding redundancy. Glyphs:
 *   - sync     → mirrored squares
 *   - streams  → flowing arrow
 *   - agents   → walking dot
 *
 * Keyboard:
 *   - Tab/Shift+Tab cycles pills.
 *   - Enter / Space toggles the active filter.
 *   - Escape clears any active filter.
 *
 * a11y:
 *   - role="group", aria-label="Substrate filter".
 *   - each pill role="checkbox", aria-checked reflects filter state.
 *   - changes announced via a polite live region in the parent.
 */
import { computed } from 'vue'
import type { Substrate } from './iso/types'

interface Props {
  active: Substrate | null
}
interface Emits {
  (e: 'update:active', value: Substrate | null): void
  (e: 'hover', value: Substrate | null): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const items: { id: Substrate; label: string; description: string }[] = [
  { id: 'sync', label: 'Sync', description: 'Mirrored surfaces' },
  { id: 'streams', label: 'Streams', description: 'Substrate channels' },
  { id: 'agents', label: 'Agents', description: 'Coordination' },
]

function toggle(id: Substrate) {
  emit('update:active', props.active === id ? null : id)
}

function onHover(id: Substrate | null) {
  emit('hover', id)
}

function onKey(e: KeyboardEvent, id: Substrate) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    toggle(id)
  } else if (e.key === 'Escape' && props.active != null) {
    e.preventDefault()
    emit('update:active', null)
  }
}

const announce = computed(() =>
  props.active
    ? `Showing ${props.active} elements only.`
    : `Showing all elements.`
)
</script>

<template>
  <div
    class="home-iso-legend"
    role="group"
    aria-label="Substrate filter"
    @mouseleave="onHover(null)"
  >
    <button
      v-for="it in items"
      :key="it.id"
      type="button"
      class="home-iso-legend__pill"
      :class="[
        `home-iso-legend__pill--${it.id}`,
        { 'is-active': active === it.id, 'is-dimmed': active && active !== it.id },
      ]"
      role="checkbox"
      :aria-checked="active === it.id"
      :aria-label="`${it.label}: ${it.description}`"
      @click="toggle(it.id)"
      @mouseenter="onHover(it.id)"
      @focus="onHover(it.id)"
      @blur="onHover(null)"
      @keydown="onKey($event, it.id)"
    >
      <!-- Substrate glyph — shape-encoded. -->
      <svg
        class="home-iso-legend__glyph"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <template v-if="it.id === 'sync'">
          <rect x="2" y="3" width="5.5" height="5.5" rx="0.5" />
          <rect x="8.5" y="7.5" width="5.5" height="5.5" rx="0.5" />
          <line x1="7.5" y1="3" x2="8.5" y2="13" />
        </template>
        <template v-else-if="it.id === 'streams'">
          <path d="M2 8 L11 8 L9 5 M11 8 L9 11" />
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="6" cy="8" r="1" />
        </template>
        <template v-else>
          <circle cx="8" cy="5" r="2" />
          <path d="M5 14 L8 8 L11 14 M5 11 L11 11" />
        </template>
      </svg>
      <span class="home-iso-legend__label">{{ it.label }}</span>
    </button>
    <div class="home-iso-legend__sr" aria-live="polite">{{ announce }}</div>
  </div>
</template>

<style scoped>
.home-iso-legend {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  padding: 4px;
  border-radius: 999px;
  background: var(--ec-surface-1, var(--vp-c-bg-soft));
  border: 1px solid var(--vp-c-divider);
  backdrop-filter: blur(8px);
}

.home-iso-legend__pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px 5px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--vp-c-text-2);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease, opacity 0.18s ease,
    border-color 0.18s ease, transform 0.18s ease;
}

.home-iso-legend__pill:hover,
.home-iso-legend__pill:focus-visible {
  color: var(--vp-c-text-1);
  background: var(--ec-surface-2, var(--vp-c-bg-mute));
  outline: none;
}

.home-iso-legend__pill:focus-visible {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.0),
    0 0 0 3px var(--vp-c-brand-1);
}

.home-iso-legend__pill.is-dimmed {
  opacity: 0.45;
}
.home-iso-legend__pill.is-active {
  color: var(--vp-c-text-1);
  background: var(--ec-surface-2, var(--vp-c-bg-mute));
  border-color: currentColor;
}

.home-iso-legend__pill--sync {
  --home-iso-legend-pill-color: var(--home-iso-sync, var(--vp-c-brand-1));
}
.home-iso-legend__pill--streams {
  --home-iso-legend-pill-color: var(--home-iso-streams, #a78bfa);
}
.home-iso-legend__pill--agents {
  --home-iso-legend-pill-color: var(--home-iso-agents, #ff8a65);
}

.home-iso-legend__glyph {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  fill: none;
  stroke: var(--home-iso-legend-pill-color);
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.home-iso-legend__pill.is-active .home-iso-legend__glyph {
  fill: var(--home-iso-legend-pill-color);
  fill-opacity: 0.18;
}

.home-iso-legend__label {
  white-space: nowrap;
  letter-spacing: 0.01em;
}

.home-iso-legend__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .home-iso-legend__pill {
    transition: none;
  }
}
</style>
