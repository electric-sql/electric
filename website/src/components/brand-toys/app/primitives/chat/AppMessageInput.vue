<script setup lang="ts">
/* AppMessageInput — composer slab (static).
   ─────────────────────────────────────────────────────────────────
   Mirrors `packages/agents-server-ui/src/components/MessageInput.tsx`
   + `MessageInput.module.css`.

   The live composer is a single flex row with `align-items: flex-end`
   wrapping `[+ AttachmentActionMenu] [textarea] [↑ composerSend]`. The
   textarea has a 40-px min-height; the buttons are 20-24 px tall and
   flex-end-aligned, so the placeholder sits at the natural top of the
   textarea while the buttons sink to the bottom of the row — visually
   reading as a "footer" beneath the text:

     ┌─────────────────────────────────────────┐
     │  Send a message...                      │  ← placeholder top
     │                                         │
     │  +                                  ↑   │  ← buttons bottom
     └─────────────────────────────────────────┘

   Geometry from the source (`MessageInput.module.css` +
   `AttachmentDrafts.module.css`):
     - .composer:        --ds-surface-raised fill, 1-px --ds-border-1
                         border, 12-px corner radius, 12-px padding,
                         --ds-shadow-1 lift.
     - .composerBody:    align-items: flex-end, gap: 8px (--ds-space-2).
     - .textarea:        min-height 40 px, 13-px chat-text, no border.
     - .addMenuTrigger:  24×24 round, --ds-text-3 colour
                         (the live AttachmentActionMenu trigger).
     - .composerSend:    24×24 round, --ds-gray-a3 disabled fill,
                         --ds-accent-9 active fill.

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
        <span class="textarea-mock">{{ placeholder }}</span>
        <span class="attach-btn" aria-hidden="true" title="Attach">
          <AppIcon :icon="Plus" :size="2" />
        </span>
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

/* Composer body — `[textarea] [+] [↑]` rendered as a single CSS
   grid where the textarea spans both columns of the top row and the
   buttons sit on a footer row beneath it. The grid gives us the
   explicit two-row composition the live UI emerges via
   `align-items: flex-end` on a 40-px-tall flex row. */

.composer-body {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  row-gap: 4px;
  column-gap: 8px;
  min-width: 0;
  width: 100%;
}

/* ───────── Textarea (mock) ─────────
   Spans both columns of the top row — the buttons sit beneath it.
   Matches the live `.textarea` font + chat-text colour rules. */

.textarea-mock {
  grid-column: 1 / -1;
  grid-row: 1;
  min-width: 0;
  font-size: var(--ds-chat-text);
  line-height: var(--ds-chat-text-lh);
  color: var(--ds-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* The live textarea has min-height 40 px; in the mockup we don't
     need that vertical room because the buttons live on their own
     row below — a single line of placeholder text is the resting
     state. */
}

/* ───────── Attach button ─────────
   Mirrors `AttachmentDrafts.module.css` `.addMenuTrigger` (the real
   trigger rendered by `AttachmentActionMenu`): 24×24 round,
   --ds-text-3 colour. Sits at the leading edge of the footer row. */

.attach-btn {
  grid-column: 1;
  grid-row: 2;
  width: 24px;
  height: 24px;
  border-radius: var(--ds-radius-full);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-3);
  justify-self: start;
}

/* ───────── Send button ─────────
   Mirrors `MessageInput.module.css` `.composerSend`: 24×24 round,
   --ds-gray-a3 disabled fill, --ds-accent-9 active fill. Sits at the
   trailing edge of the footer row. */

.composer-send {
  grid-column: 2;
  grid-row: 2;
  width: 24px;
  height: 24px;
  border-radius: var(--ds-radius-full);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--ds-gray-a3);
  color: var(--ds-text-3);
  justify-self: end;
  align-self: center;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}

.composer-send[data-active='true'] {
  background: var(--ds-accent-9);
  color: var(--ds-text-on-accent);
}
</style>
