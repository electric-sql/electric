<script setup lang="ts">
/* AppTitlebarControls — macOS hiddenInset overlay strip.
   ─────────────────────────────────────────────────────────────────
   Mirrors `TitlebarControls.tsx` from the live app: a stationary
   cluster pinned at top:0 and indented past the traffic lights.

   Icons in left-to-right order (as they ship in the live UI):
     - PanelLeftClose / PanelLeft  — sidebar toggle (we render
       PanelLeftClose since the sidebar is OPEN in the marketing
       mockup; PanelLeft can be passed via `collapsed`).
     - Search                       — search-palette trigger.
     - ChevronLeft / ChevronRight   — desktop history back / forward
       (DesktopHistoryButtons in the source). Both rendered, both
       neutral — no live state to disable them in the mockup.

   Geometry from `TitlebarControls.module.css`:
     - 44-px tall row.
     - 2-px gap between icons.
     - 84-px left inset on macOS desktop (= traffic lights gutter).
     - 24×24 button hit areas (live `<IconButton size={1}>`) with
       `--ds-radius-2` corners.
     - Each icon at size 3 (= 15 px).

   Pure primitive — does NOT include `.app-mockup-root`. Mount under
   a scene that provides the cascade. */

import {
  ChevronLeft,
  ChevronRight,
  PanelLeft,
  PanelLeftClose,
  Search,
} from 'lucide-vue-next'
import AppIcon from '../AppIcon.vue'

withDefaults(
  defineProps<{
    /** Sidebar collapsed? Drives the toggle icon variant. */
    collapsed?: boolean
    /** Bump left padding past the macOS traffic lights. Set true for
     * the macOS hiddenInset overlay placement; false for the sidebar
     * header on Windows/Linux titlebar layouts. */
    chromeInsetTarget?: boolean
  }>(),
  {
    collapsed: false,
    chromeInsetTarget: true,
  }
)
</script>

<template>
  <div
    class="titlebar-controls"
    :data-chrome-inset-target="chromeInsetTarget ? 'true' : undefined"
  >
    <span
      class="ctl-btn"
      aria-hidden="true"
      :title="collapsed ? 'Show sidebar' : 'Hide sidebar'"
    >
      <AppIcon :icon="collapsed ? PanelLeft : PanelLeftClose" :size="3" />
    </span>
    <span class="ctl-btn" aria-hidden="true" title="Search sessions">
      <AppIcon :icon="Search" :size="3" />
    </span>
    <span class="ctl-btn" aria-hidden="true" title="Back">
      <AppIcon :icon="ChevronLeft" :size="3" />
    </span>
    <span class="ctl-btn" aria-hidden="true" title="Forward">
      <AppIcon :icon="ChevronRight" :size="3" />
    </span>
  </div>
</template>

<style scoped>
.titlebar-controls {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 44px;
  /* When this strip sits as a macOS hiddenInset overlay, it needs to
     anchor at the same y as the tile headers and indent past the
     traffic lights. */
  padding-left: 0;
  flex-shrink: 0;
}

.titlebar-controls[data-chrome-inset-target='true'] {
  /* 84-px = 13 px traffic-light gutter + 58 px lights cluster + 13 px
     trailing breathing room — matches `TitlebarControls.module.css`'s
     `:global(... darwin) .controls { left: 84px }` rule. We achieve
     the same offset via padding here so the strip can sit inside a
     row instead of being absolutely positioned. */
  padding-left: 84px;
}

.ctl-btn {
  width: 24px;
  height: 24px;
  border-radius: var(--ds-radius-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-2);
  flex-shrink: 0;
}
</style>
