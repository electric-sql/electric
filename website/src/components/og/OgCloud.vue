<script setup lang="ts">
/* OgCloud — social card for the /cloud landing page.
 *
 * Renders the live `<CloudHero>` directly inside the 1200x630 OG
 * frame, paused and with its CTA buttons hidden. Reusing the live
 * hero means any text or layout tweak on /cloud propagates to the
 * social card automatically.
 *
 * See `OgSync.vue` for the rationale on the scoped overrides —
 * same pattern: a notch larger headline/tagline so the card reads
 * at thumbnail size, plus the wordmark's bbox fed in as an extra
 * exclusion rect so the mesh-of-streams canvas doesn't paint
 * underneath the brand mark in the frame's top-left corner. */
import CloudHero from '../cloud-home/CloudHero.vue'
import OgFrame from './OgFrame.vue'
import { OG_LOGO_EXCLUDE_RECT } from './ogLogoRect'
</script>

<template>
  <OgFrame>
    <CloudHero
      :paused="true"
      :hide-actions="true"
      :extra-exclude-rects="[OG_LOGO_EXCLUDE_RECT]"
    />
  </OgFrame>
</template>

<style scoped>
/* Punch up the headline and tagline a notch for the OG card —
   matches the sizing of the sync / streams / agents OG cards so
   the four landing pages share a consistent thumbnail rhythm.
   The live cloud hero is intentionally sized at the same 56px
   as the other product heroes; the OG card bumps to 80px because
   the social-card thumbnail crops the top/bottom of the live
   hero band and we want the headline to hold its own at small
   preview sizes. */
:deep(.cl-hero-name) {
  font-size: 80px;
  line-height: 1.05;
}
:deep(.cl-hero-tagline) {
  /* Tagline is a longer descriptive sentence on cloud (vs. the
     short straplines on sync / streams / agents). 32px keeps it
     legible at thumbnail size without crowding the wider line of
     text against the headline. */
  font-size: 32px;
  max-width: 880px;
  margin: 22px auto 36px;
}
:deep(.cl-hero-inner) {
  max-width: 1000px;
  /* OgFrame's stage flex-centres the hero vertically inside the
     1200x630 frame. The cloud hero's min-height (460px) anchors
     centring around the band's middle, so the headline lands a
     little high relative to the now-enlarged wordmark in the
     top-left. A small downward translate gives the headline more
     breathing room under the mark — same trick used by OgSync /
     OgStreams / OgAgents. */
  transform: translateY(32px);
}
</style>
