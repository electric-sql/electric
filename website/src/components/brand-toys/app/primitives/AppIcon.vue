<script setup lang="ts">
/* AppIcon — Vue mirror of `agents-server-ui/src/ui/Icon.tsx`.
   ─────────────────────────────────────────────────────────────────
   Wraps a `lucide-vue-next` component with the same `size` token
   system the live app uses (1 → 11 px, 2 → 13 px, 3 → 15 px,
   4 → 18 px). Mirrors `--ds-icon-{xs,sm,md,lg}` from tokens.css.

   Stroke width follows the lucide default (1.75 in 0.5xx). Colour
   is `currentColor` so the icon picks up the surrounding text colour
   — all callers should set the colour on the wrapping element.

   Pure primitive — does NOT include `.app-mockup-root`. */

import type { Component } from 'vue'

withDefaults(
  defineProps<{
    icon: Component
    size?: 1 | 2 | 3 | 4
  }>(),
  { size: 2 }
)

const SIZE_PX: Record<1 | 2 | 3 | 4, number> = {
  1: 11,
  2: 13,
  3: 15,
  4: 18,
}
</script>

<template>
  <component
    :is="icon"
    :size="SIZE_PX[size]"
    class="app-icon"
    aria-hidden="true"
  />
</template>

<style scoped>
.app-icon {
  flex-shrink: 0;
  display: inline-block;
  /* lucide ships SVGs with `currentColor` strokes; nothing extra
     needed here. */
}
</style>
