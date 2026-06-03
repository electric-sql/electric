<script setup lang="ts">
/* AppMessageInput — composer slab (static).
   ─────────────────────────────────────────────────────────────────
   Mirrors `packages/agents-server-ui/src/components/MessageInput.tsx`
   + `MessageInput.module.css` body shape:

     [+]  [textarea — "Send a message..."]                    [↑]
      │              flex                                      │
      │                                                        │
      └─ AttachmentActionMenu                              ─── Send / Stop button

   The chip strip below (model picker / sandbox picker / working dir)
   only appears on the spawn screen via `EntityContextDrawer` — NOT
   in the regular session composer. The mockup paints just the body.

   Geometry from the source:
     - .composer:    --ds-surface-raised fill, 1-px --ds-border-1
                     border, 12-px corner radius, 12-px padding,
                     --ds-shadow-1 lift.
     - .composerBody: align-items: flex-end, gap: 8px (--ds-space-2).
     - .textarea:    min-height 40 px, transparent, no border.
     - .composerSend: 24×24 round, --ds-gray-a3 disabled fill,
                      --ds-accent-9 active fill (we render `active`
                      since the mockup never types anything).

   The composer's outer .root carries -20-px top margin in the live
   product so the slab visually sits ON TOP of the chat surface above
   (combined with the bottom-fade mask on the chat surface). We
   honour that here so scenes don't have to reset it.

   Pure primitive — does NOT include `.app-mockup-root`. */

import { ArrowUp, Plus } from 'lucide-vue-next'
import AppIcon from '../AppIcon.vue'

withDefaults(
  defineProps<{
    placeholder?: string
    /**
     * Render the send button in active (accent-filled) or disabled
     * (neutral) state. The marketing mockup keeps it active to read
     * as "ready to send" — readers shouldn't see a greyed-out button.
     */
    sendActive?: boolean
  }>(),
  {
    placeholder: 'Send a message...',
    sendActive: true,
  }
)
</script>

<template>
  <div class="composer-root">
    <div class="composer">
      <div class="composer-body">
        <span class="attach-btn" aria-hidden="true" title="Attach">
          <AppIcon :icon="Plus" :size="2" />
        </span>
        <span class="textarea-mock">{{ placeholder }}</span>
        <span
          class="composer-send"
          :data-active="sendActive ? 'true' : 'false'"
          aria-hidden="true"
          title="Send message"
        >
          <AppIcon :icon="ArrowUp" :size="3" />
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer-root {
  width: 100%;
  font-family: var(--ds-font-body);
  /* Lift the slab into the chat surface above — matches the live
     composer's -20-px margin-top. The mask + bg on the chat surface
     paints over the lifted area cleanly. */
  margin-top: -20px;
  position: relative;
  z-index: 1;
}

.composer {
  background: var(--ds-surface-raised);
  border: 1px solid var(--ds-border-1);
  border-radius: var(--ds-radius-5);
  box-shadow:
    0 1px 3px rgba(15, 15, 30, 0.04),
    0 1px 1px rgba(15, 15, 30, 0.02);
  padding: 12px;
}

.composer-body {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  min-width: 0;
  width: 100%;
}

/* ───────── Attach button ─────────
   Mirrors `MessageInput.module.css` `.inlineIconButton`: 20×20,
   --ds-text-3 colour. Bottom-aligned with the textarea via the
   parent `.composer-body { align-items: flex-end }`. */

.attach-btn {
  width: 20px;
  height: 20px;
  border-radius: var(--ds-radius-3);
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-3);
  /* Sit alongside the bottom-aligned send button — small lift so the
     glyph doesn't crowd the textarea's bottom edge. */
  margin-bottom: 8px;
}

/* ───────── Textarea (mock) ───────── */

.textarea-mock {
  flex: 1;
  min-width: 0;
  align-self: stretch;
  /* Match the live textarea's 40-px min-height + chat-text font. The
     placeholder colour also matches the textarea's ::placeholder
     rule (--ds-text-3). */
  min-height: 40px;
  display: flex;
  align-items: flex-start;
  padding-top: 10px;
  font-size: var(--ds-chat-text);
  line-height: var(--ds-chat-text-lh);
  color: var(--ds-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ───────── Send button ─────────
   Mirrors `MessageInput.module.css` `.composerSend`: 24×24 round,
   --ds-gray-a3 disabled fill, --ds-accent-9 active fill. */

.composer-send {
  width: 24px;
  height: 24px;
  border-radius: var(--ds-radius-full);
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--ds-gray-a3);
  color: var(--ds-text-3);
  /* Live `.composerBody` is `align-items: flex-end`, so the send
     button sits flush with the bottom of the textarea (no margin). */
  transition:
    background 0.12s ease,
    color 0.12s ease;
}

.composer-send[data-active='true'] {
  background: var(--ds-accent-9);
  color: var(--ds-text-on-accent);
}
</style>
