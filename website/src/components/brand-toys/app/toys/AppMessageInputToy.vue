<script setup lang="ts">
/* AppMessageInputToy — brand-toys wrapper.
   ─────────────────────────────────────────────────────────────────
   Renders the composer slab centred on a chat-surface-shaped column.
   See APP_DESKTOP_MOCKUP_PLAN.md §6 for the controls schema. */

import '../shared.css'
import AppMessageInput from '../primitives/chat/AppMessageInput.vue'

withDefaults(
  defineProps<{
    placeholder?: string
    queuedCount?: number
    theme?: 'light' | 'dark'
  }>(),
  {
    placeholder: 'Reply to Horton…',
    queuedCount: 0,
    theme: 'dark',
  }
)
</script>

<template>
  <div class="input-toy app-mockup-root" :data-theme="theme">
    <div class="input-toy-stage">
      <AppMessageInput :placeholder="placeholder" :queued-count="queuedCount" />
    </div>
  </div>
</template>

<style scoped>
.input-toy {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--ds-bg);
}

.input-toy-stage {
  width: 100%;
  max-width: 640px;
  /* Reset the composer's negative-top margin so the slab sits in the
     middle of the toy stage rather than lifted off the top. */
  margin-top: 16px;
}

/* The composer's own root has a -16px margin-top that lifts it onto a
   chat surface in scenes — neutralise it here for the standalone toy. */
.input-toy-stage :deep(.composer-root) {
  margin-top: 0;
}
</style>
