<script setup lang="ts">
/* AppTileShellToy — brand-toys wrapper.
   ─────────────────────────────────────────────────────────────────
   Renders an empty AppTileShell with a sample header so the chrome
   geometry can be reviewed before any real content lands. The
   header now demonstrates the full action cluster — status pill +
   runner badge + sandbox badge + view toggles + overflow menu — to
   match the live `EntityHeader.tsx`.
   See APP_DESKTOP_MOCKUP_PLAN.md §6 for the controls schema. */

import '../shared.css'
import AppTileHeader from '../primitives/workspace/AppTileHeader.vue'
import AppTileShell from '../primitives/workspace/AppTileShell.vue'

withDefaults(
  defineProps<{
    title?: string
    sessionId?: string
    status?:
      | 'idle'
      | 'running'
      | 'streaming'
      | 'spawning'
      | 'paused'
      | 'stopped'
    chromeInsetTarget?: boolean
    showClose?: boolean
    theme?: 'light' | 'dark'
  }>(),
  {
    title: 'Test Message Received',
    sessionId: 'horton/70cqMB5GnW',
    status: 'running',
    chromeInsetTarget: false,
    showClose: false,
    theme: 'dark',
  }
)
</script>

<template>
  <div class="tile-toy app-mockup-root" :data-theme="theme">
    <AppTileShell>
      <template #header>
        <AppTileHeader
          :title="title"
          :session-id="sessionId"
          :status="status"
          runner-label="Electric Agents Desktop"
          sandbox-label="Local"
          active-view="chat"
          :views="['chat', 'state']"
          :chrome-inset-target="chromeInsetTarget"
          :show-close="showClose"
        />
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
