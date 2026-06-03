<script setup lang="ts">
/* AppSidebar — fixture-driven sidebar primitive.
   ─────────────────────────────────────────────────────────────────
   Mirrors the running app's sidebar geometry pretty exactly:

     [44-px header band — empty spacer]
     [tree row pad — 8-px gutter all around]
       [New session row  +  ⌘N kbd hint]
       [Section header   "Today"]
       [Entity rows from fixture]

   The header band is included ONLY when the surrounding scene
   wraps this primitive in a frame WITHOUT a top titlebar. When a
   scene composes `<AppTitlebar>` above the sidebar (the
   `HeroChatStateScene` shape), the titlebar's own height supplies
   the y-offset and the sidebar's top spacer is suppressed via the
   `:noHeader="true"` prop — same y-rhythm as the live macOS app.

   Tree connectors are drawn per-row via ::before / ::after just like
   `SidebarRow.module.css` — 1-px trunk + 1-px horizontal stub at
   row centre, with a curved L-shape at the last child of each
   subtree. The trunk x is fixed at 14 px (= base 3-px padding +
   icon-slot half-width 11 px), matching the live `--tree-trunk-x`.

   Pure primitive — does NOT include a `.app-mockup-root` wrapper.
   Mount inside a scene or toy that provides the cascade. */

import { computed } from 'vue'
import AppSidebarRow from './AppSidebarRow.vue'
import { SIDEBAR_FIXTURE, type MockSidebarRow } from '../../fixtures'

interface Props {
  /** Override the fixture for variant scenes / per-toy demos. */
  rows?: readonly MockSidebarRow[]
  /**
   * Suppress the 44-px header spacer. Scenes that compose a titlebar
   * above the sidebar set this to true — the titlebar provides the
   * y-offset and an additional spacer would push everything down by
   * 44 extra pixels.
   */
  noHeader?: boolean
  /** Optional section header — rendered between the new-session
   * row and the entity tree. */
  sectionLabel?: string
  /**
   * Override which row is the visual selection (regardless of the
   * fixture's own `selected` flag). Use the entity url as the
   * matcher — `null` falls back to the fixture's own selected row.
   */
  selectedUrl?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  rows: () => SIDEBAR_FIXTURE,
  noHeader: false,
  sectionLabel: 'Today',
  selectedUrl: null,
})

/**
 * For each row, compute whether it's the LAST row in its subtree
 * (so its connector terminates with the L-curve rather than a
 * straight trunk). A row is the last child of its subtree when the
 * next row in the list has depth strictly less than its own — i.e.
 * the tree pops back up before resuming.
 *
 * Rows at depth 0 don't draw connectors at all; the first sibling
 * stub starts at depth 1.
 *
 * Returned array is parallel to `props.rows` with three flags per
 * entry — drives the CSS attribute selectors below.
 */
const annotated = computed(() => {
  return props.rows.map((row, i) => {
    const next = props.rows[i + 1]
    const isLastInSubtree = !next || next.depth < row.depth
    const hasConnector = row.depth > 0
    return {
      row,
      hasConnector,
      isLastInSubtree,
      isSelected:
        props.selectedUrl !== null
          ? props.selectedUrl === row.url
          : !!row.selected,
    }
  })
})
</script>

<template>
  <aside class="sidebar" aria-label="Sessions">
    <div v-if="!noHeader" class="sidebar-header" aria-hidden="true" />

    <div class="tree-row">
      <!--
        New session affordance. The real product clicks through to a
        fresh entity wizard; the mockup just paints it as a kickoff
        target so the eye sees one before the existing-session list.
      -->
      <button class="new-session-row" type="button" tabindex="-1">
        <span class="new-session-icon-slot">
          <!-- Pencil glyph — drawn with two pseudo-elements rather
               than an icon library. 12×12 px, --ds-text-1. -->
          <span class="new-session-pencil" aria-hidden="true" />
        </span>
        <span class="new-session-label">New session</span>
        <span class="new-session-kbd mono" aria-hidden="true">
          <span class="kbd">⌘</span><span class="kbd">N</span>
        </span>
      </button>

      <button
        v-if="sectionLabel"
        class="section-header"
        type="button"
        tabindex="-1"
      >
        <span class="section-label">{{ sectionLabel }}</span>
      </button>

      <!--
        Tree rows. Connector lines are drawn per-row via
        data-attribute hooks below; depth/last-child status determines
        which pseudo-elements paint.
      -->
      <div class="tree" :style="{ '--tree-trunk-x': '14px' }">
        <div
          v-for="entry in annotated"
          :key="entry.row.url"
          class="tree-node"
          :data-has-connector="entry.hasConnector ? 'true' : 'false'"
          :data-last-in-subtree="entry.isLastInSubtree ? 'true' : 'false'"
        >
          <AppSidebarRow
            :title="entry.row.title"
            :type="entry.row.type"
            :status="entry.row.status"
            :depth="entry.row.depth"
            :child-count="entry.row.childCount"
            :expanded="entry.row.expanded"
            :selected="entry.isSelected"
          />
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  /* Real sidebar default width = 240px. Scenes can override via
     CSS — the primitive itself just fills its parent column. */
  width: 100%;
  height: 100%;
  flex-shrink: 0;
  background: var(--ds-chrome-bg);
  display: flex;
  flex-direction: column;
  font-family: var(--ds-font-body);
  /* Tighten the line-height baseline; rows + section header set
     their own. */
  font-size: 12px;
  /* Hairline divider against the workspace column on the right. */
  border-right: 1px solid var(--ds-divider);
}

/* Empty header band — scenes without a titlebar above (e.g. a
   sidebar-only toy) get a 44-px spacer so the new-session row sits
   below the visible-area top. */
.sidebar-header {
  flex-shrink: 0;
  height: 44px;
}

.tree-row {
  padding: 0 8px 8px;
  flex: 1;
  min-height: 0;
  /* Custom property the AppSidebarRow's connector lines read off
     the tree wrapper. Set on `.tree` below; declared here too as a
     fallback in case the wrapper is removed in a future variant. */
  --tree-line-color: var(--ds-border-2);
  --tree-stub-w: 9px;
  --tree-corner-radius: 6px;
}

/* ───────── New session row ───────── */

.new-session-row {
  all: unset;
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  height: var(--ds-row-height-md);
  padding-left: 3px;
  padding-right: 3px;
  border-radius: var(--ds-radius-item);
  cursor: default;
  color: var(--ds-text-1);
}

.new-session-icon-slot {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-1);
  position: relative;
}

/* Pencil glyph — a 9×9 rotated rectangle with a small "tip" pseudo
   below it. Crude but legible at 12×12 — what your eye reads on
   the real "+ new session" pencil icon. */
.new-session-pencil {
  width: 11px;
  height: 11px;
  position: relative;
  display: inline-block;
}
.new-session-pencil::before {
  content: '';
  position: absolute;
  left: 1px;
  top: 1px;
  width: 8px;
  height: 2.5px;
  background: currentColor;
  transform: rotate(-45deg) translate(0, 4.2px);
  border-radius: 0.5px;
}
.new-session-pencil::after {
  content: '';
  position: absolute;
  right: 0;
  top: 0;
  width: 3px;
  height: 3px;
  background: currentColor;
  transform: rotate(45deg);
  border-radius: 0.5px;
}

.new-session-label {
  font-size: var(--ds-text-sm);
  flex: 1;
  min-width: 0;
  text-align: left;
}

/* Keycap hint — same pattern the command palette uses. Faded by
   default; the live UI brightens these on row hover. We leave them
   dimmed since the mockup never hovers. */
.new-session-kbd {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  margin-right: 3px;
  opacity: 0.55;
}

.kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: var(--ds-radius-1);
  background: var(--ds-chip-bg);
  border: 1px solid var(--ds-chip-border);
  color: var(--ds-text-2);
  font-size: var(--ds-text-2xs);
  line-height: 1;
}

/* ───────── Section header ───────── */

.section-header {
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 100%;
  padding: 14px 4px 4px 8px;
  border-radius: var(--ds-radius-item);
  color: var(--ds-text-3);
  cursor: default;
}

.section-label {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ───────── Tree connector lines ───────── */

.tree {
  /* `--tree-trunk-x` is set inline on the wrapper element above so
     it cascades to every .tree-node descendant. We re-anchor it
     here too in case future variants drop the inline style. */
  --tree-trunk-x: 14px;
  position: relative;
}

.tree-node {
  position: relative;
}

/* Vertical trunk through every connector-bearing row. Centred on
   the trunk x (with the 0.5px nudge that keeps the 1-px stroke on
   pixel boundaries the same way the source does). */
.tree-node[data-has-connector='true'] :deep(.row)::after {
  content: '';
  position: absolute;
  left: calc(var(--tree-trunk-x) - 0.5px);
  top: 0;
  bottom: 0;
  border-left: 1px solid var(--ds-border-2);
  pointer-events: none;
}

/* Horizontal stub branching out at row vertical mid. */
.tree-node[data-has-connector='true'] :deep(.row)::before {
  content: '';
  position: absolute;
  left: calc(var(--tree-trunk-x) - 0.5px);
  top: calc(50% - 0.5px);
  width: 9px;
  border-top: 1px solid var(--ds-border-2);
  pointer-events: none;
}

/* Last child of subtree: trunk ends at the row centre with a curved
   corner. ::after becomes an L (left + bottom borders + radius);
   ::before is dropped so the horizontal arm isn't doubled. */
.tree-node[data-has-connector='true'][data-last-in-subtree='true']
  :deep(.row)::after {
  bottom: auto;
  height: 50%;
  width: 9px;
  border-bottom: 1px solid var(--ds-border-2);
  border-bottom-left-radius: 6px;
}

.tree-node[data-has-connector='true'][data-last-in-subtree='true']
  :deep(.row)::before {
  display: none;
}
</style>
