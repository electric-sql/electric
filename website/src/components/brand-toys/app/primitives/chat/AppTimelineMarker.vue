<script setup lang="ts">
/* AppTimelineMarker — quiet timeline log entry.
   ─────────────────────────────────────────────────────────────────
   Mirrors `EntityTimeline.module.css` `.statusPill` — a small
   left-bordered text block that sits flush with the message column
   and reads as a quiet log entry rather than a centered chip. The
   live UI uses these for "spawned · 14:59", "sandbox · Local",
   "stopped · 15:01", etc.

   Geometry from the source:
     - 2-px left border (--ds-gray-a3).
     - 10-px left padding, 0 right.
     - --ds-text-4 muted text colour, 0.7 opacity, letter-spacing 0.02em.
     - Inline-flex with a 6-px gap between the two text spans.

   Use with multiple instances side-by-side via the parent's flex gap;
   the primitive itself doesn't add lateral spacing between markers.

   Pure primitive — does NOT include `.app-mockup-root`. */

withDefaults(
  defineProps<{
    /** Leading label — e.g. "spawned", "sandbox", "stopped". */
    label: string
    /** Trailing value — e.g. "14:59", "Local". Hidden if empty. */
    value?: string
  }>(),
  { value: '' }
)
</script>

<template>
  <span class="timeline-marker">
    <span class="marker-label">{{ label }}</span>
    <template v-if="value">
      <span class="marker-sep">·</span>
      <span class="marker-value">{{ value }}</span>
    </template>
  </span>
</template>

<style scoped>
.timeline-marker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0 2px 10px;
  border-left: 2px solid var(--ds-gray-a3);
  color: var(--ds-text-4, var(--ds-text-3));
  letter-spacing: 0.02em;
  font-family: var(--ds-font-body);
  font-size: var(--ds-text-xs);
  line-height: var(--ds-text-xs-lh, 1.4);
  opacity: 0.7;
}

.marker-sep {
  opacity: 0.7;
}
</style>
