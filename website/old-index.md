---
layout: home
title: 'ElectricSQL'
titleTemplate: 'Sync with your stack'
description: 'Sync little subsets of your Postgres data into local apps and services.'
hero:
  name: 'Realtime sync'
  text: 'for Postgres'
  tagline: >-
    Sync is the best way of building modern&nbsp;apps.
    Electric&nbsp;solves sync so&nbsp;that&nbsp;you don't have to.
  image:
    src: /img/home/zap-with-halo.svg
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
      text: '​'
      target: '_blank'
      link: https://github.com/electric-sql/electric
    - theme: alt
      text: >-
        GitHub
      target: '_blank'
      link: https://github.com/electric-sql/electric
features:
  - title: Electric
    details: >-
      <span class="para">
        Sync subsets of your Postgres data into
        local&nbsp;apps and&nbsp;services.
      </span>
      <span class="feature-cta electric-star-count">
      </span>
    icon:
      src: '/img/icons/electric.svg'
    link: '/product/electric'
  - title: Cloud
    details: >-
      <span class="para">
        Hosted sync that's blazing fast and scales
        <span class="no-wrap-lg">to millions</span>
        <span class="no-wrap">of users</span>.
      </span>
      <span class="feature-cta sign-up-link">
      </span>
    icon:
      src: '/img/icons/ddn.svg'
    link: '/product/cloud'
  - title: PGlite
    details: >-
      <span class="para">
        Sync into a lightweight WASM Postgres with
        <span class="no-wrap">real-time</span>,
        <span class="no-wrap">reactive bindings</span>.
      </span>
      <span class="feature-cta pglite-star-count">
      </span>
    icon:
      src: '/img/icons/pglite.svg'
    link: '/product/pglite'
---

<script setup>
import { onMounted } from 'vue'

import VPFeatures from 'vitepress/dist/client/theme-default/components/VPFeatures.vue'

import { data as initialStarCounts } from './data/count.data.ts'
import { data as useCases } from './data/use-cases.data.ts'

import { data as demosData } from './data/demos.data.ts'
const { homepage_demos } = demosData

import MasonryTweets from './src/components/MasonryTweets.vue'
import UseCases from './src/components/UseCases.vue'

import { getStarCount } from './src/lib/star-count.ts'

import HomeYourStackSimplified from './src/partials/home-your-stack-simplified.md'
import HomeCTA from './src/partials/home-cta.md'

const tweets = [
  {name: 'kyle', id: '1825531359949173019'},
  {name: 'fabio', id: '1823267981188542525'},
  {name: 'next', id: '1823015591579472318', hideMedium: true},
  {name: 'johannes', id: '1826338840153571362'},
  {name: 'nikita', id: '1760801296188313783', hideSmall: true},
  {name: 'thor', id: '1824023614225854726', hideMedium: true},
  {name: 'copple', id: '1782681344340091115'},
  {name: 'postgres.new', id: '1822992862436381032', hideSmall: true},
  {name: 'prisma', id: '1816050679561039976', hideMedium: true},
  {name: 'materialisedview', id: '1769744384025829468', hideSmall: true},
  {name: 'devtools.fm', id: '1810328072236802198', hideMedium: true},
  {name: 'local-first conf', id: '1808473434575229096', hideMedium: true},
]

const formatStarCount = (count) => (
  `<span class="muted">(</span><span> ☆ </span><span>${Math.round(count / 100) / 10}k</span><span> </span><span class="muted">)</span>`
)

const renderStarCount = async (repoName, initialStarCount) => {
  let container = document.querySelector(`span.feature-cta.${repoName}-star-count`)

  if (!container) {
    return
  }

  let linkEl = container.querySelector('a')
  if (linkEl) {
    return
  }

  linkEl = document.createElement('a')
  linkEl.setAttribute('href', `https://github.com/electric-sql/${repoName}`)
  linkEl.setAttribute('_target', `_blank`)
  linkEl.classList.add('VPButton', 'medium', 'alt')
  linkEl.innerHTML = '<span class="vpi-social-github"></span> GitHub'

  const countEl = document.createElement('span')
  countEl.classList.add('count')
  countEl.innerHTML = formatStarCount(initialStarCount)

  linkEl.append(countEl)
  container.append(linkEl)

  const count = await getStarCount(repoName, initialStarCount)
  countEl.innerHTML = formatStarCount(count)
}

onMounted(async () => {
  if (typeof window !== 'undefined' && document.querySelector) {
    const githubLinks = document.querySelectorAll(
      '.actions a[href^="https://github.com"]'
    )

    let icon = document.querySelector('.actions .vpi-social-github')
    if (!icon) {
      githubLinks.forEach((link) => {
        const icon = document.createElement('span')
        icon.classList.add('vpi-social-github')

        link.prepend(icon)
      })
    }

    let signUp = document.querySelector(`span.feature-cta.sign-up-link`)
    if (!signUp) {
      return
    }
    let linkEl = signUp.querySelector('a')
    if (linkEl) {
      return
    }
    linkEl = document.createElement('a')
    linkEl.setAttribute('href', '/product/cloud/sign-up')
    linkEl.classList.add('VPButton', 'medium', 'alt')
    linkEl.innerHTML = '<span class="vpi-electric-icon"></span> Sign up'
    signUp.append(linkEl)


    renderStarCount('electric', initialStarCounts.electric)
    renderStarCount('pglite', initialStarCounts.pglite)
  }
})
</script>

<div class="features-content">

## Demo apps

See the kind of applications you can build with Electric
<span class="no-wrap-sm">
and what they
<span class="no-wrap">
feel like to use</span></span>.

</div>
<div class="demos-grid homepage">
  <DemoListing v-for="(demo, index) in homepage_demos"
      :demo="demo"
      :key="index"
  />
</div>

<MasonryTweets :tweets="tweets" />

<div class="features-content your-stack-simplified">
  <HomeYourStackSimplified />
</div>

<UseCases :cases="useCases" />

<div class="features-content">
  <div class="home-cta">
    <HomeCTA />
  </div>
</div>
