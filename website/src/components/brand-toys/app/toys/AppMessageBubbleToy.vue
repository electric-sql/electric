<script setup lang="ts">
/* AppMessageBubbleToy — brand-toys wrapper.
   ─────────────────────────────────────────────────────────────────
   Renders the user-message bubble centred on a chat-surface-shaped
   column so the bubble reads as a real "user turn" cut-out.
   See APP_DESKTOP_MOCKUP_PLAN.md §6 for the controls schema. */

import '../shared.css'
import AppMessageBubble from '../primitives/chat/AppMessageBubble.vue'

withDefaults(
  defineProps<{
    text?: string
    sender?: string
    timestamp?: string
    theme?: 'light' | 'dark'
  }>(),
  {
    text: 'refactor packages/auth to use the new session helper, write a quick test',
    sender: 'sam',
    timestamp: 'just now',
    theme: 'dark',
  }
)
</script>

<template>
  <div class="bubble-toy app-mockup-root" :data-theme="theme">
    <div class="bubble-toy-stage">
      <AppMessageBubble :text="text" :sender="sender" :timestamp="timestamp" />
    </div>
  </div>
</template>

<style scoped>
.bubble-toy {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--ds-bg);
}

.bubble-toy-stage {
  width: 100%;
  max-width: 640px;
}
</style>
