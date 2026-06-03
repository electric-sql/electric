<script setup lang="ts">
/* AppTileShellToy — brand-toys wrapper.
   ─────────────────────────────────────────────────────────────────
   Renders an empty AppTileShell with a sample header so the chrome
   geometry can be reviewed before any real content lands.
   See APP_DESKTOP_MOCKUP_PLAN.md §6 for the controls schema. */

import '../shared.css'
import AppTileHeader from '../primitives/workspace/AppTileHeader.vue'
import AppTileShell from '../primitives/workspace/AppTileShell.vue'

withDefaults(
  defineProps<{
    title?: string
    theme?: 'light' | 'dark'
  }>(),
  {
    title: '/horton/code-refactor',
    theme: 'dark',
  }
)
</script>

<template>
  <div class="tile-toy app-mockup-root" :data-theme="theme">
    <AppTileShell>
      <template #header>
        <AppTileHeader :title="title" status="streaming" />
      </template>
      <div class="tile-toy-placeholder">
        <span>tile body</span>
      </div>
    </AppTileShell>
  </div>
</template>

<style scoped>
.tile-toy {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--ds-bg-page, var(--ds-bg));
}

.tile-toy-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-3);
  font-family: var(--ds-font-mono);
  font-size: 12px;
  background: repeating-linear-gradient(
    45deg,
    transparent 0,
    transparent 8px,
    var(--ds-divider) 8px,
    var(--ds-divider) 9px
  );
}
</style>
