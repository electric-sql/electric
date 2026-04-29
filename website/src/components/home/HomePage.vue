<script setup>
import { onMounted } from 'vue'

import HomeHero from './HomeHero.vue'
import HomeProductSection from './HomeProductSection.vue'

import BackedBySection from './sections/BackedBySection.vue'
import LatestNewsSection from './sections/LatestNewsSection.vue'
import ScalesToSection from './sections/ScalesToSection.vue'
import WorksWithSection from './sections/WorksWithSection.vue'

import AgentsCTAStrap from './straps/AgentsCTAStrap.vue'
import ManagedCloudStrap from './straps/ManagedCloudStrap.vue'
import NoSilosStrap from './straps/NoSilosStrap.vue'

/* WhyEverythingSection — thesis strap that sits between the hero
   and the product panels. Frames the platform value prop as
   "Everything you need for multi-X collaboration" with a
   scroll-driven rotator on `X` (agent / user / device). */
import WhyEverythingSection from './why/WhyEverythingSection.vue'

/* WhyLoopsSection — "Managed agents without the lock-in" strap.
   Sits directly under the hero as the unfold of the hero's claim:
   centred title + 3-up benefit cards (data wiring / business
   systems / collaboration) drawn from the 28 Apr review call. */
import WhyLoopsSection from './why/WhyLoopsSection.vue'

/* HomePage is the single page component for the site root. We render every
   strap / section as a sibling so each one is naturally full-bleed and can
   manage its own inner max-width container — exactly the pattern used by
   the agents / streams / sync landing pages.

   This is regular SSR-friendly Vue. The homepage sections all render on the
   server; any future visual treatments can slot back into the existing
   placeholders in `HomeHero` and `HomeProductSection`. */

onMounted(() => {
  if (typeof window !== 'undefined' && document.querySelector) {
    document
      .querySelectorAll('.actions a[href^="https://github.com"]')
      .forEach((link) => {
        if (!link.querySelector('.vpi-social-github')) {
          const icon = document.createElement('span')
          icon.classList.add('vpi-social-github')
          link.prepend(icon)
        }
      })
  }
})
</script>

<template>
  <div class="home-page-shell">
    <!-- Bands run light / dark down the page to break the scroll
         into distinct strata, but the rhythm is *not* a strict
         alternation. The three product sections all sit on the
         page's default surface so they read as a single
         contiguous trio (the iso scene + canvas backgrounds want
         a common backdrop); from there the per-section straps
         below pick the alternation back up so each call-to-
         action band lands on its own stratum, ending on the
         tinted `AgentsCTAStrap` bookend. -->
    <HomeHero />

    <WhyLoopsSection />

    <HomeProductSection product="agents" />
    <HomeProductSection product="streams" />
    <HomeProductSection product="sync" />

    <NoSilosStrap :dark="true" />
    <WorksWithSection />
    <ManagedCloudStrap :dark="true" />
    <ScalesToSection />

    <WhyEverythingSection :dark="true" />

    <LatestNewsSection />
    <BackedBySection />
    <AgentsCTAStrap />
  </div>
</template>

<style scoped>
.home-page-shell {
  width: 100%;
}
</style>
