<script setup lang="ts">
/* ChatTileContent — composed chat-tile content.
   ─────────────────────────────────────────────────────────────────
   Drops the chat parts (bubble + agent response + composer) into an
   AppTileShell + AppTileHeader. This is the desktop "left tile" of the
   hero scene; the same composition is reused at smaller widths
   (sidebar collapsed, single-tile workspace) without changes.

   Layout:
     [AppTileHeader  /horton/code-refactor                        ⋯]
     [chat surface — scrolling column, chat-surface-width capped]
     [AppMessageInput — composer slab, lifted into the surface above]

   The chat surface uses a centred column capped at `--chat-surface-width`
   (set by AppTileShell's body via the shared chat-column geometry).
   At narrow container widths the column collapses to the full width.

   Animation pass-through:
     - `progress`, `paused`, `cps`, `state`, `hasCodeBlock`, `hasToolCall`
       are forwarded to AppAgentResponse — same RAF driver inside.
     - `density` swaps the surface vertical padding (comfortable=24px,
       compact=12px). Scenes flip this on small containers.

   Pure primitive — does NOT include `.app-mockup-root`. */

import AppAgentResponse from '../../chat/AppAgentResponse.vue'
import AppMessageBubble from '../../chat/AppMessageBubble.vue'
import AppMessageInput from '../../chat/AppMessageInput.vue'
import AppTileHeader from '../AppTileHeader.vue'
import AppTileShell from '../AppTileShell.vue'
import { CHAT_FIXTURE } from '../../../fixtures'

withDefaults(
  defineProps<{
    title?: string
    /** Forwarded to AppAgentResponse. */
    state?: 'idle' | 'thinking' | 'streaming' | 'completed'
    progress?: number | null
    paused?: boolean
    cps?: number
    hasCodeBlock?: boolean
    hasToolCall?: boolean
    /** Layout density. `compact` removes chat-surface vertical padding
     * for sub-700-px container widths. */
    density?: 'comfortable' | 'compact'
  }>(),
  {
    title: '/horton/code-refactor',
    state: 'streaming',
    progress: null,
    paused: false,
    cps: 60,
    hasCodeBlock: true,
    hasToolCall: true,
    density: 'comfortable',
  }
)
</script>

<template>
  <AppTileShell>
    <template #header>
      <AppTileHeader :title="title" status="streaming" />
    </template>

    <div class="chat-surface" :data-density="density">
      <div class="chat-column">
        <AppMessageBubble :text="CHAT_FIXTURE.userPrompt" sender="sam" />
        <AppAgentResponse
          :state="state"
          :progress="progress"
          :paused="paused"
          :cps="cps"
          :has-code-block="hasCodeBlock"
          :has-tool-call="hasToolCall"
        />
      </div>
    </div>
    <div class="composer-column">
      <div class="composer-inner">
        <AppMessageInput placeholder="Reply to Horton…" />
      </div>
    </div>
  </AppTileShell>
</template>

<style scoped>
.chat-surface {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  /* Soft bottom-fade mask so the chat surface visually melts into the
     composer slab below — matches the live product. */
  -webkit-mask-image: linear-gradient(
    to bottom,
    black 0,
    black calc(100% - 32px),
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    black 0,
    black calc(100% - 32px),
    transparent 100%
  );
}

.chat-surface[data-density='comfortable'] {
  padding: 24px 16px 32px;
}
.chat-surface[data-density='compact'] {
  padding: 12px 12px 24px;
}

.chat-column {
  margin-inline: auto;
  width: min(var(--chat-surface-width), 100%);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Composer column — same width math as the chat surface. The composer
   primitive itself sets a -16-px top margin so the slab visually sits
   ON TOP of the chat surface above. */
.composer-column {
  flex-shrink: 0;
  padding: 0 16px 16px;
}

.composer-inner {
  margin-inline: auto;
  width: min(var(--chat-surface-width), 100%);
}
</style>
