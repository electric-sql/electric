<script setup lang="ts">
/* AppSidebarRowToy — brand-toys wrapper.
   ─────────────────────────────────────────────────────────────────
   Wraps `<AppSidebarRow>` in `.app-mockup-root` + a strip background
   (chrome-bg, matching the live sidebar surface) so the row reads
   as it would inside the real sidebar. The toy stage centres the
   row vertically and pads laterally for breathing room.

   See APP_DESKTOP_MOCKUP_PLAN.md §6 for the controls schema. */

import '../shared.css'
import AppSidebarRow from '../primitives/sidebar/AppSidebarRow.vue'
import type { MockEntityStatus } from '../fixtures'

withDefaults(
  defineProps<{
    title?: string
    type?: string
    status?: MockEntityStatus
    depth?: number
    childCount?: number
    expanded?: boolean
    selected?: boolean
    theme?: 'light' | 'dark'
  }>(),
  {
    title: '/horton/code-refactor',
    type: 'horton',
    status: 'running',
    depth: 0,
    childCount: 0,
    expanded: false,
    selected: false,
    theme: 'dark',
  }
)
</script>

<template>
  <div class="row-toy app-mockup-root" :data-theme="theme">
    <div class="row-toy-strip">
      <AppSidebarRow
        :title="title"
        :type="type"
        :status="status"
        :depth="depth"
        :child-count="childCount"
        :expanded="expanded"
        :selected="selected"
      />
    </div>
  </div>
</template>

<style scoped>
.row-toy {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.row-toy-strip {
  width: 100%;
  max-width: 280px;
  background: var(--ds-chrome-bg);
  /* Match the real sidebar's tree-row inner gutter (8 px) so the
     row's selection/hover background paints inside the same column
     it would in the live product. */
  padding: 0 8px;
  border-radius: 8px;
  border: 1px solid var(--ds-divider);
}
</style>
