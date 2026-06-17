<script setup lang="ts">
/* AppAgentResponseToy — brand-toys wrapper.
   ─────────────────────────────────────────────────────────────────
   Renders the streaming agent response on a chat-surface-shaped
   column so we can review the typewriter cadence + caret tracking +
   tool-call pill animation in isolation.
   See APP_DESKTOP_MOCKUP_PLAN.md §6 for the controls schema. */

import { computed } from 'vue'
import '../shared.css'
import AppAgentResponse from '../primitives/chat/AppAgentResponse.vue'

const props = withDefaults(
  defineProps<{
    state?: 'idle' | 'thinking' | 'streaming' | 'completed'
    /** -1 = let the internal RAF driver run; otherwise scrub to value. */
    progress?: number
    paused?: boolean
    cps?: number
    hasCodeBlock?: boolean
    hasToolCall?: boolean
    theme?: 'light' | 'dark'
  }>(),
  {
    state: 'streaming',
    progress: -1,
    paused: false,
    cps: 60,
    hasCodeBlock: true,
    hasToolCall: true,
    theme: 'dark',
  }
)

/* Convert the toy's `-1 = auto` convention into the primitive's
   `null = auto` convention so the brand-toys numeric slider can still
   drive a manual scrub when ≥ 0. */
const progressProp = computed(() =>
  props.progress < 0 ? null : props.progress
)
</script>

<template>
  <div class="response-toy app-mockup-root" :data-theme="theme">
    <div class="response-toy-stage">
      <AppAgentResponse
        :state="state"
        :progress="progressProp"
        :paused="paused"
        :cps="cps"
        :has-code-block="hasCodeBlock"
        :has-tool-call="hasToolCall"
      />
    </div>
  </div>
</template>

<style scoped>
.response-toy {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  background: var(--ds-bg);
  overflow: auto;
}

.response-toy-stage {
  width: 100%;
  max-width: 720px;
}
</style>
