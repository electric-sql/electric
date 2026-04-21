<script setup>
import { onMounted } from 'vue'

import HomeHero from './HomeHero.vue'
import HomeProductSection from './HomeProductSection.vue'

import BackedBySection from './sections/BackedBySection.vue'
import DeploymentSection from './sections/DeploymentSection.vue'
import LatestNewsSection from './sections/LatestNewsSection.vue'
import OpenSourceSection from './sections/OpenSourceSection.vue'
import ScalesToSection from './sections/ScalesToSection.vue'
import WorksWithSection from './sections/WorksWithSection.vue'

import NoSilosStrap from './straps/NoSilosStrap.vue'

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
    <HomeHero />

    <HomeProductSection product="agents" :dark="true" />
    <HomeProductSection product="streams" />
    <HomeProductSection product="sync" :dark="true" />

    <NoSilosStrap />
    <WorksWithSection />
    <ScalesToSection />
    <LatestNewsSection />
    <BackedBySection />
    <OpenSourceSection />
    <DeploymentSection />
  </div>
</template>

<style scoped>
.home-page-shell {
  width: 100%;
}
</style>
