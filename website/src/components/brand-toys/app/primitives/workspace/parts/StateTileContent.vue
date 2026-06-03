<script setup lang="ts">
/* StateTileContent — composed state-inspector content.
   ─────────────────────────────────────────────────────────────────
   Drops the AppStateInspector into an AppTileShell + AppTileHeader.
   This is the desktop "right tile" of the hero scene; reused at
   narrow container widths only when the chat tile is also visible.

   Animation pass-through:
     - `pulseRate`, `paused` are forwarded to AppStateInspector.
     - `density` swaps the inspector's compact mode (drops the
       StreamDB strip + tightens row heights) for sub-700-px widths.

   Pure primitive — does NOT include `.app-mockup-root`. */

import AppStateInspector from '../../state/AppStateInspector.vue'
import AppTileHeader from '../AppTileHeader.vue'
import AppTileShell from '../AppTileShell.vue'

withDefaults(
  defineProps<{
    title?: string
    sessionId?: string
    pulseRate?: number
    paused?: boolean
    density?: 'comfortable' | 'compact'
    /** Forwarded to AppTileHeader — the right tile in a split shows
     * a close X. Single-tile scenes leave it false. */
    showClose?: boolean
    /** Bump the header padding past macOS traffic lights — set true
     * on the leftmost tile when sidebar (and any tile to the left)
     * is hidden. Mirrors the same prop on `ChatTileContent`. */
    chromeInsetTarget?: boolean
  }>(),
  {
    title: 'Test Message Received',
    sessionId: 'horton/70cqMB5GnW',
    pulseRate: 0.8,
    paused: false,
    density: 'comfortable',
    showClose: true,
    chromeInsetTarget: false,
  }
)
</script>

<template>
  <AppTileShell>
    <template #header>
      <AppTileHeader
        :title="title"
        :session-id="sessionId"
        status="running"
        runner-label="Electric Agents Desktop"
        sandbox-label="Local"
        active-view="state"
        :views="['chat', 'state']"
        :chrome-inset-target="chromeInsetTarget"
        :show-close="showClose"
      />
    </template>

    <div class="state-surface">
      <AppStateInspector
        :pulse-rate="pulseRate"
        :paused="paused"
        :density="density"
      />
    </div>
  </AppTileShell>
</template>

<style scoped>
.state-surface {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--ds-bg);
  border-top: 1px solid var(--ds-divider);
}
</style>
