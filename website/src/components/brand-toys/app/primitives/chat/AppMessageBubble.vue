<script setup lang="ts">
/* AppMessageBubble — user-message bubble.
   ─────────────────────────────────────────────────────────────────
   Mirrors `packages/agents-server-ui/src/components/UserMessage.module.css`
   geometry exactly:

   - Outer column: 100% wide (the surrounding chat surface caps it).
   - Bubble: --ds-input-bg fill, 1-px hairline, 12-px corner radius
     (--ds-radius-5), soft 1-px drop-shadow. 12-px padding.
   - Body text: --ds-chat-text size, anywhere wrap, white-space: pre-wrap
     so newlines in the fixture render naturally.
   - Meta row (sender · time): 40% opacity; padding-inline: 12px so the
     timestamp aligns with the body text column rather than the bubble
     edge — same trick the source uses.

   Pure primitive — does NOT include `.app-mockup-root`. Mount inside
   a scene or toy that provides the cascade.
*/

withDefaults(
  defineProps<{
    /** Body text — single string (newlines preserved). */
    text: string
    /** Sender label (left of the meta row). */
    sender?: string
    /** Time-ago label (right of the meta row). */
    timestamp?: string
  }>(),
  {
    sender: 'sam',
    timestamp: 'just now',
  }
)
</script>

<template>
  <div class="bubble-root">
    <div class="bubble">
      <p class="body">{{ text }}</p>
    </div>
    <div class="meta">
      <span class="meta-sender">{{ sender }}</span>
      <span class="meta-sep">·</span>
      <span class="meta-time">{{ timestamp }}</span>
    </div>
  </div>
</template>

<style scoped>
.bubble-root {
  margin-inline: auto;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: var(--ds-font-body);
}

.bubble {
  background: var(--ds-input-bg);
  border: 1px solid var(--ds-gray-a3);
  border-radius: var(--ds-radius-5);
  box-shadow:
    0 1px 3px rgba(15, 15, 30, 0.04),
    0 1px 1px rgba(15, 15, 30, 0.02);
  padding: 12px;
  position: relative;
}

.body {
  margin: 0;
  font-size: var(--ds-chat-text);
  line-height: var(--ds-chat-text-lh);
  color: var(--ds-text-1);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.meta {
  display: inline-flex;
  align-items: baseline;
  /* Live `<Stack gap={2}>` → `--ds-space-2` (= 8px). */
  gap: var(--ds-space-2);
  opacity: 0.4;
  /* Match the bubble's 12-px horizontal padding so the meta row
     aligns with the body's text column, not the bubble's outer edge. */
  padding-inline: 12px;
  font-size: var(--ds-text-xs);
  line-height: var(--ds-text-xs-lh);
  color: var(--ds-text-2);
  /* Live `.meta` is plain `<Text size={1} tone="muted">` — no caps
     tweaks, no letter-spacing. */
}

.meta-sep {
  opacity: 0.7;
}
</style>
