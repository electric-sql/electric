<script setup lang="ts">
/* AppMessageInput — composer slab (static).
   ─────────────────────────────────────────────────────────────────
   Mirrors `packages/agents-server-ui/src/components/MessageInput.module.css`:

   - Outer .root: -20-px top margin so the slab visually sits ON TOP of
     the chat surface above. We don't replicate this in the primitive
     itself — scenes/tile shells decide if they want the lift; the
     primitive just paints the composer at 0,0.
   - Composer fill: --ds-surface-raised (raised input surface).
   - Border: 1-px --ds-border-1, 12-px corner radius.
   - Soft 1-px drop-shadow (same recipe as the user bubble).
   - 12-px padding all around — keeps the textarea text column aligned
     with the bubble text column above.

   Static primitive — no animation, no live focus state. The mockup
   doesn't need a real textarea, just the visual slab + a placeholder
   line + the standard "send" button on the right edge.

   Pure primitive — does NOT include `.app-mockup-root`. */

withDefaults(
  defineProps<{
    placeholder?: string
    /** Number of queued/pending messages indicator pip count. */
    queuedCount?: number
  }>(),
  {
    placeholder: 'Reply to Horton…',
    queuedCount: 0,
  }
)
</script>

<template>
  <div class="composer-root">
    <div class="composer">
      <div class="composer-inner">
        <span class="placeholder">{{ placeholder }}</span>
        <div class="composer-controls">
          <span
            v-if="queuedCount > 0"
            class="queue-pip"
            :title="`${queuedCount} queued`"
          >
            +{{ queuedCount }}
          </span>
          <span class="send-btn" aria-label="Send">
            <span class="send-glyph" />
          </span>
        </div>
      </div>
      <div class="composer-toolbar">
        <span class="tool-chip">
          <span class="tool-chip-glyph" />
          <span class="tool-chip-label">Attach</span>
        </span>
        <span class="tool-chip mono">claude-4.6-sonnet</span>
        <span class="tool-spacer" />
        <span class="kbd-hint mono">
          <span class="kbd">⌘</span><span class="kbd">↵</span>
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
     composer's -20px margin-top. Scenes that need the slab to sit
     flush should reset this with a parent CSS override. */
  margin-top: -16px;
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
  gap: 8px;
}

.composer-inner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-height: 36px;
}

.placeholder {
  flex: 1;
  min-width: 0;
  color: var(--ds-text-3);
  font-size: var(--ds-chat-text);
  line-height: var(--ds-chat-text-lh);
  /* Two lines worth of breathing room so the slab reads as a real
     textarea even with one-line placeholder text. */
  padding: 6px 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.composer-controls {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.queue-pip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--ds-radius-full);
  background: var(--ds-gray-a3);
  color: var(--ds-text-2);
  font-size: 10px;
  line-height: 1;
  font-weight: 500;
}

.send-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--ds-radius-full);
  background: var(--ds-accent-9);
  color: var(--ds-text-on-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}

/* Send glyph — small upward triangle drawn with two borders. */
.send-glyph {
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-bottom: 7px solid currentColor;
  /* Optical-centre nudge — the triangle's centre of mass sits low,
     translateY pulls it back up to mid. */
  transform: translateY(-1px);
}

/* ───────── Toolbar (attach / model / kbd) ───────── */

.composer-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  border-top: 1px solid var(--ds-divider);
  padding-top: 8px;
}

.tool-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--ds-radius-full);
  background: transparent;
  color: var(--ds-text-3);
  font-size: var(--ds-text-xs);
  border: 1px solid var(--ds-border-1);
}

.tool-chip.mono {
  font-family: var(--ds-font-mono);
  font-size: 11px;
}

.tool-chip-glyph {
  width: 10px;
  height: 10px;
  border: 1.5px solid currentColor;
  border-radius: 2px;
  position: relative;
  display: inline-block;
}
.tool-chip-glyph::before {
  content: '';
  position: absolute;
  inset: 1.5px;
  border-top: 1.5px solid currentColor;
}

.tool-chip-label {
  line-height: 1;
}

.tool-spacer {
  flex: 1;
}

.kbd-hint {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  opacity: 0.7;
}

.kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  border-radius: var(--ds-radius-1);
  background: var(--ds-chip-bg);
  border: 1px solid var(--ds-chip-border);
  color: var(--ds-text-2);
  font-size: var(--ds-text-2xs);
  line-height: 1;
}
</style>
