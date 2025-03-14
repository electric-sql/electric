---
layout: home
hero:
  name: 'Sync'
  text: 'solved'
  tagline: >-
    Sync makes apps awesome.<br />Electric solves sync.
  actions:
    - theme: brand
      text: Sign-up to Cloud
      link: /product/cloud/sign-up
    - theme: brand
      text: Sign-up
      link: /product/cloud/sign-up
    - theme: alt
      text: Quickstart
      link: /docs/quickstart
    - theme: alt
      text: "​"
      target: '_blank'
      link: https://github.com/electric-sql/electric
    - theme: alt
      text: GitHub
      target: '_blank'
      link: https://github.com/electric-sql/electric
  image:
    src: /img/home/zap-with-halo.svg
---

<script setup>
import { onMounted } from 'vue'

import {
  BackedBySection,
  LatestNewsSection,
  NoSilosStrap,
  OpenSourceSection,
  PGliteStrap,
  ScalesToSection,
  SolvesSyncSection,
  SyncAwesomeSection,
  UsedBySection,
  WorksWithSection
} from './src/components/home'

onMounted(() => {
  if (typeof window !== 'undefined' && document.querySelector) {
    document.querySelectorAll('.actions a[href^="https://github.com"]').forEach((link) => {
      if (!link.querySelector('.vpi-social-github')) {
        const icon = document.createElement('span')
        icon.classList.add('vpi-social-github')

        link.prepend(icon)
      }
    })
  }
})
</script>

<SyncAwesomeSection />
<SolvesSyncSection />
<WorksWithSection />
<ScalesToSection />

<NoSilosStrap />

<UsedBySection />
<BackedBySection />
<OpenSourceSection />

<PGliteStrap />

<LatestNewsSection />
