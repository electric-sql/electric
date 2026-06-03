<script setup lang="ts">
/* StateTileContent — composed state-explorer content.
   ─────────────────────────────────────────────────────────────────
   Drops the AppStateTable into an AppTileShell + AppTileHeader. This
   is the desktop "right tile" of the hero scene; reused at narrow
   container widths only when the chat tile is also visible.

   Animation pass-through:
     - `pulseRate`, `paused` are forwarded to AppStateTable.
     - `density` swaps the table padding (header-only flag for compact).

   Pure primitive — does NOT include `.app-mockup-root`. */

import AppStateTable from '../../state/AppStateTable.vue'
import AppTileHeader from '../AppTileHeader.vue'
import AppTileShell from '../AppTileShell.vue'

withDefaults(
  defineProps<{
    title?: string
    pulseRate?: number
    paused?: boolean
    density?: 'comfortable' | 'compact'
  }>(),
  {
    title: 'state — /horton/code-refactor',
    pulseRate: 0.8,
    paused: false,
    density: 'comfortable',
  }
)
</script>

<template>
  <AppTileShell>
    <template #header>
      <AppTileHeader :title="title" status="streaming" />
    </template>

    <div class="state-surface" :data-density="density">
      <AppStateTable
        :pulse-rate="pulseRate"
        :paused="paused"
        :show-header="density === 'comfortable'"
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
}

.state-surface[data-density='comfortable'] {
  padding: 0;
}
.state-surface[data-density='compact'] {
  padding: 0;
}
</style>
