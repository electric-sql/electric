<script setup lang="ts">
/* OgStreams — social card for the /streams landing page.
 *
 * Renders the live `<StreamsHero>` directly inside the 1200x630 OG
 * frame, paused and with its CTA buttons + install-pill copy
 * button hidden. Reusing the live hero means any text or layout
 * tweak on /streams propagates to the social card automatically.
 *
 * See `OgSync.vue` for the rationale on the scoped overrides —
 * same pattern: a notch larger headline/tagline so the card reads
 * at thumbnail size, plus the wordmark's bbox fed in as an extra
 * exclusion rect so the rails don't run underneath the brand mark
 * in the frame's top-left corner. */
import StreamsHero from "../streams-home/StreamsHero.vue"
import OgFrame from "./OgFrame.vue"
import { OG_LOGO_EXCLUDE_RECT } from "./ogLogoRect"
</script>

<template>
  <OgFrame>
    <StreamsHero
      :paused="true"
      :hide-actions="true"
      :hide-copy="true"
      :extra-exclude-rects="[OG_LOGO_EXCLUDE_RECT]"
    />
  </OgFrame>
</template>

<style scoped>
:deep(.ds-hero-name) {
  font-size: 80px;
  line-height: 1.05;
}
:deep(.ds-hero-text) {
  font-size: 36px;
  max-width: 880px;
  margin: 22px auto 36px;
}
:deep(.ds-hero-inner) {
  max-width: 1000px;
  /* See OgSync.vue for the rationale on this small downward
     translate — gives the headline more breathing room under the
     enlarged wordmark in the frame's top-left corner. */
  transform: translateY(32px);
}
</style>
