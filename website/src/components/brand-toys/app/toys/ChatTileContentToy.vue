<script setup lang="ts">
/* ChatTileContentToy — brand-toys wrapper.
   ─────────────────────────────────────────────────────────────────
   Renders the composed ChatTileContent (header + chat surface +
   composer) at a tile-shaped size so we can review the full chat
   tile composition with the typewriter running.
   See APP_DESKTOP_MOCKUP_PLAN.md §6 for the controls schema. */

import { computed } from 'vue'
import '../shared.css'
import ChatTileContent from '../primitives/workspace/parts/ChatTileContent.vue'

const props = withDefaults(
  defineProps<{
    /** -1 = let the internal RAF driver run; otherwise scrub to value. */
    progress?: number
    paused?: boolean
    cps?: number
    density?: 'comfortable' | 'compact'
    chromeInsetTarget?: boolean
    theme?: 'light' | 'dark'
  }>(),
  {
    progress: -1,
    paused: false,
    cps: 60,
    density: 'comfortable',
    chromeInsetTarget: false,
    theme: 'dark',
  }
)

const progressProp = computed(() =>
  props.progress < 0 ? null : props.progress
)
</script>

<template>
  <div class="chat-tile-toy app-mockup-root" :data-theme="theme">
    <ChatTileContent
      :progress="progressProp"
      :paused="paused"
      :cps="cps"
      :density="density"
      :chrome-inset-target="chromeInsetTarget"
    />
  </div>
</template>

<style scoped>
.chat-tile-toy {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--ds-bg);
}
</style>
