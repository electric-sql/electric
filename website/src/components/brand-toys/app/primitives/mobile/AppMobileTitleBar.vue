<script setup lang="ts">
/* AppMobileTitleBar — mobile session-screen header.
   ─────────────────────────────────────────────────────────────────
   Mirrors `packages/agents-mobile/src/components/Header.tsx`
   in `align="center"` mode + the leading/trailing slot chrome
   the SessionScreen uses:

     [<chevron-back, accent11>]   [Title — centered, 16/600]
                                                        [⋯ kebab, 22/text2]

   Geometry from the live RN source:
     - Outer row: 44 px tall (rowHeight.xl), 8-px horizontal padding,
       `tokens.bg` background, no border.
     - Title text: fontSize.lg (16 px) / fontWeight 600 / tokens.text1.
       Single-line truncate.
     - Leading + trailing clusters are positioned absolutely so the
       title stays optically centred regardless of glyph widths.
     - Back button: lucide ChevronLeft, 26 px, `tokens.accent11`
       (= teal/blue accent), strokeWidth 2.25 — matches Apple's
       `UINavigationBar` back affordance.
     - Trailing more button: lucide MoreHorizontal, 22 px,
       `tokens.text2` colour, strokeWidth 1.75, in a 36×36 button
       with 8-px radius (matches `<TopBarIconButton>`).

   Pure primitive — does NOT include `.app-mockup-root`. */

import { ChevronLeft, MoreHorizontal } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    /** Title shown centred in the bar. Truncates to a single line
     * with ellipsis if it overflows. */
    title?: string
  }>(),
  {
    title: 'Test Message Received',
  }
)
</script>

<template>
  <header class="mobile-title-bar">
    <span class="leading" aria-hidden="true">
      <ChevronLeft class="leading-icon" :size="26" :stroke-width="2.25" />
    </span>
    <div class="title-block">
      <h1 class="title">{{ title }}</h1>
    </div>
    <span class="trailing" aria-hidden="true">
      <span class="trailing-button">
        <MoreHorizontal class="trailing-icon" :size="22" :stroke-width="1.75" />
      </span>
    </span>
  </header>
</template>

<style scoped>
.mobile-title-bar {
  position: relative;
  flex-shrink: 0;
  height: 44px;
  background: var(--ds-bg);
  /* No border — matches the live RN Header which deliberately
     omits the bottom hairline so the screen reads as one
     continuous surface. */
}

/* Leading / trailing clusters positioned absolutely so the title
   stays optically centred regardless of icon widths — the same
   pattern Header.tsx uses for `align="center"`. */
.leading,
.trailing {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  padding: 0 8px;
}

.leading {
  left: 0;
  /* The back chevron tints with the system accent — matches the
     `tokens.accent11` colour the live `HeaderBackButton` paints. */
  color: var(--ds-accent-11);
}

.trailing {
  right: 0;
  color: var(--ds-text-2);
}

.leading-icon {
  display: inline-block;
}

.trailing-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
}

.trailing-icon {
  display: inline-block;
}

.title-block {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Reserve space on either side for the absolutely-positioned
     leading / actions clusters so a long title truncates instead
     of overlapping the icons — matches the live Header.tsx
     `paddingHorizontal: 56`. */
  padding: 0 56px;
  pointer-events: none;
}

.title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--ds-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
</style>
