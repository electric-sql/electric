<script setup lang="ts">
/* AppMessageInput — composer slab (static).
   ─────────────────────────────────────────────────────────────────
   Mirrors the live composer's *footer-row* layout — same pattern
   `packages/agents-server-ui/src/components/views/NewSessionView.tsx`
   uses with `.composerTextarea` on top + `.composerFooter` below.

   Layout:

     ┌─[ .composer (12-px padding) ]──────────────────┐
     │  Send a message…                               │  ← textarea, full width, placeholder at left edge
     │  +                                       ↑     │  ← composer-footer: attach at left, send at right
     └────────────────────────────────────────────────┘

   The placeholder sits at the composer's left padding column — the
   same column the `+` attach button starts in. That's the key visual
   the chat-only `MessageInput` flex-row layout doesn't produce
   (because there the textarea is offset by the attach button + gap),
   but the spawn-screen `NewSessionView` does — and that's what the
   reference screenshots show.

   Geometry from the source (`NewSessionPage.module.css` for the
   footer pattern + `MessageInput.module.css` for the surface):
     - .composer:        --ds-surface-raised fill, 1-px --ds-border-1
                         border, 12-px corner radius, 12-px padding,
                         --ds-shadow-1 lift.
     - .composerTextarea: chat-text font, 0 padding, no border.
     - .composerFooter:  flex row, space-between, gap 12px.
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
      <span class="textarea-mock">{{ placeholder }}</span>
      <div class="composer-footer">
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
  display: flex;
  flex-direction: column;
}

/* ───────── Textarea (mock) ─────────
   Mimics `.composerTextarea` — no padding, chat-text colour, sits at
   the composer's left padding column so the placeholder aligns with
   the attach button column directly below. */

.textarea-mock {
  display: block;
  width: 100%;
  font-size: var(--ds-chat-text);
  line-height: var(--ds-chat-text-lh);
  color: var(--ds-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ───────── Composer footer ─────────
   Mirrors `.composerFooter` from `NewSessionPage.module.css` — flex
   row with `justify-content: space-between` so the attach cluster
   sits at the leading edge and the send cluster at the trailing
   edge. No top padding/margin; the natural baseline of the textarea
   above + a small visual buffer is enough. */

.composer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ds-space-2);
  width: 100%;
}

/* ───────── Attach button ─────────
   Mirrors `AttachmentDrafts.module.css` `.addMenuTrigger`: 24×24
   round, --ds-text-3 colour. Sits at the left edge of the footer
   row, directly below the placeholder text. */

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
