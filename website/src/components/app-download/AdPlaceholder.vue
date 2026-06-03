<script setup lang="ts">
/* Placeholder block for the /app page rewrite.

   Drops a styled, dashed-border rectangle into a section as a stand-in
   for content (text + cards + screenshots) that lands in later phases
   of the rewrite. Mirrors the visual language of the rest of the
   landing pages (rounded border, soft bg, mono label) so that
   placeholders read as deliberate scaffolding rather than as broken
   content if a reviewer browses the page mid-PR.

   Each placeholder carries a `data-placeholder` attribute that names
   the section / asset slot — useful both for reviewers reading the
   diff and for grepping later when assets land. Swap each placeholder
   for the real content one section at a time; the surrounding chrome
   doesn't change. */
defineProps<{
  /** Short label rendered inside the placeholder, e.g.
   *  "§3 — Three ways to use it". Also written to `data-placeholder`. */
  name: string
  /** Optional CSS aspect-ratio (e.g. "16/9", "21/9"). When omitted,
   *  the placeholder uses its content's intrinsic height with the
   *  shared `min-height` floor. */
  aspect?: string
  /** Optional second-line caption explaining what eventually lives
   *  in this slot. Kept short — full intent lives in the plan doc. */
  sublabel?: string
}>()
</script>

<template>
  <div
    class="ad-placeholder"
    :data-placeholder="name"
    :style="aspect ? { aspectRatio: aspect } : undefined"
  >
    <span class="ad-placeholder-label mono">{{ name }}</span>
    <span v-if="sublabel" class="ad-placeholder-sublabel">{{ sublabel }}</span>
  </div>
</template>

<style scoped>
.ad-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 24px;
  min-height: 200px;
  width: 100%;
  border: 1.5px dashed
    color-mix(in srgb, var(--vp-c-text-3) 45%, var(--vp-c-divider));
  border-radius: 16px;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 55%, transparent);
  color: var(--vp-c-text-3);
  text-align: center;
  box-sizing: border-box;
}

.ad-placeholder-label {
  font-size: 13px;
  letter-spacing: 0.02em;
  color: var(--vp-c-text-2);
  word-break: break-word;
  max-width: 640px;
}

.ad-placeholder-sublabel {
  font-size: 12px;
  line-height: 1.5;
  color: var(--vp-c-text-3);
  max-width: 520px;
}
</style>
