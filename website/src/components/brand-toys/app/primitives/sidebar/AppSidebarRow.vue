<script setup lang="ts">
/* AppSidebarRow — single sidebar entity row.
   ─────────────────────────────────────────────────────────────────
   Mirrors `packages/agents-server-ui/src/components/SidebarRow.tsx`
   geometry exactly:

   - Height: `--ds-row-height-md` (28px).
   - Icon slot: 22-px column, status dot centred inside.
   - Title (`--ds-text-1` / 12px) flexes to fill, ellipsis on overflow.
   - Type label (`--ds-text-3` / 10px lowercase) sits trailing-aligned
     with a small +N count when the subtree is collapsed.
   - When the row is selected, background lifts to `--ds-accent-a3`.
   - Stopped rows fade to 55% opacity.
   - Indent: 12-px per depth level + 3-px base padding-left
     (concentric halo with the inner pin button — this is the
     "concentric halo rule" called out in the source CSS).

   We don't render the pin / expand-on-hover affordances or the
   HoverCard info popout — both are interactive states that don't
   show up in a still or animated mockup loop. The chevron-down for
   expanded subtrees IS rendered (visible at rest in the source) so
   the tree state reads correctly.

   Pure primitive — does NOT include a `.app-mockup-root` wrapper.
   Mount inside a scene or toy that provides the cascade. */

import { ChevronDown } from 'lucide-vue-next'
import AppIcon from '../AppIcon.vue'
import type { MockEntityStatus } from '../../fixtures'

withDefaults(
  defineProps<{
    /** Display title — the entity's nice name. */
    title: string
    /** Type chip text, e.g. `horton`, `worker`, `research`. */
    type: string
    /** Status dot colour. */
    status: MockEntityStatus
    /** Tree indent depth, 0-based. */
    depth?: number
    /** Subtree child count. > 0 enables the +N badge / chevron. */
    childCount?: number
    /** True when the subtree under this row is expanded. */
    expanded?: boolean
    /** True when this row is the active selection. */
    selected?: boolean
  }>(),
  {
    depth: 0,
    childCount: 0,
    expanded: false,
    selected: false,
  }
)

const INDENT_PX = 12
const BASE_PADDING_LEFT = 3
</script>

<template>
  <div
    class="row"
    :class="{
      selected,
      stopped: status === 'stopped',
    }"
    :style="{ paddingLeft: `${BASE_PADDING_LEFT + depth * INDENT_PX}px` }"
    role="button"
    tabindex="-1"
    :title="title"
  >
    <span class="icon-slot">
      <span
        class="status-dot"
        :data-status="status"
        :aria-label="`Status: ${status}`"
      />
    </span>

    <span class="title">{{ title }}</span>

    <span
      class="type"
      :class="{
        'type-with-count': childCount > 0 && !expanded,
      }"
    >
      {{ type
      }}<template v-if="childCount > 0 && !expanded">
        +{{ childCount }}</template
      >
    </span>

    <!--
      When the subtree is expanded the source renders an always-visible
      chevron-down that the user clicks to collapse. We render the same
      glyph at rest. CSS triangle, no SVG dependency.
    -->
    <span
      v-if="childCount > 0 && expanded"
      class="expand-btn-visible"
      aria-hidden="true"
    >
      <AppIcon :icon="ChevronDown" :size="2" />
    </span>
  </div>
</template>

<style scoped>
.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  height: var(--ds-row-height-md);
  padding-right: 3px;
  border-radius: var(--ds-radius-item);
  user-select: none;
  color: var(--ds-text-1);
  background: transparent;
  font-family: var(--ds-font-body);
  /* The real row uses cursor: pointer + hover background; the mockup
     leans static (no hover for stills), but we keep the row inert so
     it's not visually clickable. */
  cursor: default;
}

.row.selected {
  background: var(--ds-accent-a3);
}

.row.stopped {
  opacity: 0.55;
}

/* ───────── Icon slot + status dot ───────── */

.icon-slot {
  position: relative;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  /* Default = stopped grey. Specific statuses below override. */
  background: var(--ds-gray-8);
}

/* Status hue mapping — matches StatusDot.tsx in agents-server-ui:
     active / running → blue
     idle             → green
     spawning / paused → amber
     stopped          → gray-8
     killed           → red
   We add `streaming` as an alias for running (the live entity stream
   uses both names in different code paths; the mockup fixture uses
   `streaming` to read more product-y in screenshots). */
.status-dot[data-status='running'],
.status-dot[data-status='streaming'] {
  background: var(--ds-blue-9);
}

.status-dot[data-status='idle'] {
  background: var(--ds-green-9);
}

.status-dot[data-status='spawning'],
.status-dot[data-status='paused'] {
  background: var(--ds-amber-9);
}

.status-dot[data-status='stopped'] {
  background: var(--ds-gray-8);
}

/* ───────── Title ───────── */

.title {
  flex: 1;
  min-width: 0;
  font-size: var(--ds-text-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Tall enough to show descenders (g, p, y); the row stays at
     --ds-row-height-md via align-items: center, so this doesn't
     grow the row. */
  line-height: 1.3;
}

/* ───────── Type label ───────── */

.type {
  flex-shrink: 0;
  padding-right: 5px;
  font-size: var(--ds-text-2xs);
  color: var(--ds-text-3);
  text-transform: lowercase;
  line-height: 1;
  /* Drop 1px so the smaller cap-height label optically shares the
     title's baseline — same trick the source uses. */
  transform: translateY(1px);
}

/* When the row also renders the always-on chevron-down for expanded
   subtrees, drop the trailing 5px gutter — the chevron is then the
   rightmost element and the row's 3px padding-right is its concentric
   halo. */
.type:has(+ .expand-btn-visible) {
  padding-right: 0;
}

/* ───────── Always-visible chevron (expanded subtree) ───────── */

.expand-btn-visible {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--ds-radius-2);
  color: var(--ds-text-3);
}
</style>
