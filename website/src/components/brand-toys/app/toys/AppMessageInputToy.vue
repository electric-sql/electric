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
    sendActive?: boolean
    theme?: 'light' | 'dark'
  }>(),
  {
    placeholder: 'Send a message...',
    sendActive: true,
    theme: 'dark',
  }
)
</script>

<template>
  <div class="input-toy app-mockup-root" :data-theme="theme">
    <div class="input-toy-stage">
      <AppMessageInput :placeholder="placeholder" :send-active="sendActive" />
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
  margin-top: 16px;
}

/* The composer's own root has a -20px margin-top that lifts it onto
   a chat surface in scenes — neutralise it here for the standalone
   toy so the slab sits at its natural baseline. */
.input-toy-stage :deep(.composer-root) {
  margin-top: 0;
}
</style>
