<script setup lang="ts">
/* OgSync — social card for the /sync landing page.
 *
 * Renders the live `<SyncHero>` directly inside the 1200x630 OG
 * frame, paused and with its CTA buttons + install-pill copy
 * button hidden. Reusing the live hero means any text or layout
 * tweak on /sync propagates to the social card automatically.
 *
 * The scoped `:deep()` overrides below tune the live hero for the
 * social card's fixed dimensions: bumping the headline / tagline a
 * notch so they read at thumbnail size, and feeding the wordmark's
 * bbox in as an extra exclusion rect so the fan-out canvas doesn't
 * paint table rows / shapes underneath the brand mark in the
 * frame's top-left corner. */
import SyncHero from '../sync-home/SyncHero.vue'
import OgFrame from './OgFrame.vue'
import { OG_LOGO_EXCLUDE_RECT } from './ogLogoRect'
</script>

<template>
  <OgFrame>
    <SyncHero
      :paused="true"
      :hide-actions="true"
      :hide-copy="true"
      :extra-exclude-rects="[OG_LOGO_EXCLUDE_RECT]"
    />
  </OgFrame>
</template>

<style scoped>
/* Punch up the headline and tagline a notch for the OG card.
   The live hero is sized for a wide hero band on a tall page;
   at thumbnail social-card scale the same sizes read a touch
   small, so we bump them just enough to feel intentional
   without changing the live page. */
:deep(.sh-hero-name) {
  font-size: 80px;
  line-height: 1.05;
}
:deep(.sh-hero-text) {
  font-size: 36px;
  max-width: 880px;
  margin: 22px auto 36px;
}
:deep(.sh-hero-inner) {
  max-width: 1000px;
  /* OgFrame's stage flex-centres the hero vertically inside the
     1200x630 frame, which sits the headline a hair too close to the
     enlarged wordmark in the top-left. A small downward translate
     gives the headline a touch more breathing room under the mark
     without disturbing the cross-axis flex math. */
  transform: translateY(32px);
}
</style>
