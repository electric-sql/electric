<script setup lang="ts">
/* AppMessageInput — composer slab (static).
   ─────────────────────────────────────────────────────────────────
   Mirrors `packages/agents-server-ui/src/components/MessageInput.tsx`
   + `MessageInput.module.css` exactly:

   - `.composerBody` is a SINGLE flex row with `align-items: flex-end`
     and `gap: 8px`. NOT a two-row grid.
   - The textarea has `min-height: 40px` so the body floors at 40 px
     even when empty. Buttons are 24×24 and flex-end-aligned, so they
     sink to the bottom of the 40-px row while the placeholder text
     starts at the natural top.
   - That's what produces the visual "footer" effect — the gap above
     the buttons is exactly `40 - 24 = 16 px`, no extra row padding.

     ┌───────────── 40 px ─────────────┐
     │  Send a message...              │  ← placeholder top
     │                                 │
     │  +                          ↑   │  ← buttons bottom (24×24)
     └─────────────────────────────────┘

   Geometry from the source (`MessageInput.module.css` +
   `AttachmentDrafts.module.css`):
     - .composer:        --ds-surface-raised fill, 1-px --ds-border-1
                         border, 12-px corner radius, 12-px padding,
                         --ds-shadow-1 lift.
     - .composerBody:    display: flex, align-items: flex-end,
                         gap: 8px (--ds-space-2).
     - .textarea:        flex: 1, min-height: 40px, 13-px chat-text.
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
        <span class="attach-btn" aria-hidden="true" title="Attach">
          <AppIcon :icon="Plus" :size="2" />
        </span>
        <span class="textarea-mock">
          <span class="textarea-placeholder">{{ placeholder }}</span>
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

/* Composer body — single flex row. `align-items: flex-end` sinks the
   24-px buttons to the bottom of the 40-px textarea row. `gap: 8px`
   matches the live `--ds-space-2`. The "footer" feel is emergent —
   it's just the textarea's min-height + flex-end alignment, not a
   second row with extra padding. */

.composer-body {
  display: flex;
  align-items: flex-end;
  gap: var(--ds-space-2);
  min-width: 0;
  width: 100%;
}

/* ───────── Textarea (mock) ─────────
   Mimics the live `.textarea`: flex:1, min-height:40px, chat-text.
   We render the placeholder via an inner span aligned to the top so
   the visual matches a real empty textarea (text starts at the top
   even though the surrounding row is 40 px tall). */

.textarea-mock {
  flex: 1;
  min-width: 0;
  min-height: 40px;
  display: flex;
  align-items: flex-start;
  font-size: var(--ds-chat-text);
  line-height: var(--ds-chat-text-lh);
  color: var(--ds-text-3);
}

.textarea-placeholder {
  display: block;
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ───────── Attach button ─────────
   Mirrors `AttachmentDrafts.module.css` `.addMenuTrigger`: 24×24
   round, --ds-text-3 colour. flex-end aligns it to the bottom of
   the 40-px row alongside the send button. */

.attach-btn {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: var(--ds-radius-full);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-3);
}

/* ───────── Send button ─────────
   Mirrors `MessageInput.module.css` `.composerSend`: 24×24 round,
   --ds-gray-a3 disabled fill, --ds-accent-9 active fill. */

.composer-send {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: var(--ds-radius-full);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--ds-gray-a3);
  color: var(--ds-text-3);
  transition:
    background 0.12s ease,
    color 0.12s ease;
}

.composer-send[data-active='true'] {
  background: var(--ds-accent-9);
  color: var(--ds-text-on-accent);
}
</style>
