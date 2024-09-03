---
layout: home
title: 'ElectricSQL'
titleTemplate: 'Postgres Sync'
description: 'Your data, in sync, wherever you need it.'
hero:
  name: "Why fetch when"
  text: "you can sync?"
  tagline: >-
    Swap out your queries, data fetching and caching for
    bulletproof sync<span class="hidden-xs"> that just works</span>.
  image:
    src: /img/home/zap-with-halo.svg
  actions:
    - theme: brand
      text: Quickstart
      link: /docs/quickstart
    - theme: alt
      text: >-
        Star on GitHub
      target: '_blank'
      link: https://github.com/electric-sql
features:
  - title: Electric Sync
    details: >-
      <span class="para">
        Sync subsets of your Postgres data into
        local&nbsp;apps and&nbsp;environments.
      </span>
      <span class="feature-cta electric-star-count">
        <a href="https://github.com/electric-sql/electric"
            target="_blank"
            class="VPButton medium alt">
          GitHub
        </a>
      </span>
    icon:
      src: '/img/icons/electric.svg'
    link: '/product/electric'
  - title: Data Delivery Network
    details: >-
      <span class="para">
        Sync data faster than you can query it.
        <span class="no-wrap-lg">Scale out to</span>
        millions
        <span class="no-wrap">of users</span>.
      </span>
      <span class="feature-cta">
        <a class="ddn VPButton medium alt"
            href="/docs/benchmarks">
          <span class="vpi-electric-icon"></span>
          View benchmarks
        </a>
      </span>
    icon:
      src: '/img/icons/ddn.svg'
    link: '/product/ddn'
  - title: PGlite
    details: >-
      <span class="para">
        Embed a lightweight WASM Postgres with
        <span class="no-wrap">real-time</span>,
        <span class="no-wrap">reactive bindings</span>.
      </span>
      <span class="feature-cta pglite-star-count">
        <a href="https://github.com/electric-sql/pglite"
            target="_blank"
            class="VPButton medium alt">
          GitHub
        </a>
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
  const linkEl = document.querySelector(`.feature-cta.${repoName}-star-count a`)

  let countEl = linkEl.querySelector('.count')

  if (!countEl) {
    countEl = document.createElement('span')
    countEl.classList.add('count')
    countEl.innerHTML = formatStarCount(initialStarCount)

    const icon = document.createElement('span')
    icon.classList.add('vpi-social-github')
    linkEl.prepend(icon)
  }

  linkEl.append(countEl)

  const count = await getStarCount(repoName, initialStarCount)
  countEl.innerHTML = formatStarCount(count)
}

onMounted(async () => {
  if (typeof window !== 'undefined' && document.querySelector) {
    const githubLinks = document.querySelectorAll(
      '.actions a[href="https://github.com/electric-sql"]'
    )

    let icon = document.querySelector('.actions .vpi-social-github')
    if (!icon) {
      githubLinks.forEach((link) => {
        const icon = document.createElement('span')
        icon.classList.add('vpi-social-github')

        link.prepend(icon)
      })
    }

    renderStarCount('electric', initialStarCounts.electric)
    renderStarCount('pglite', initialStarCounts.pglite)
  }
})
</script>

<style>
  .feature-cta {
    margin: 14px 0 7px -2px;
  }
  @media (min-width: 768px) and (max-width: 825px) {
    .feature-cta {
      margin-left: -6px;
      margin-right: -16px;
      transform: scale(0.95);
      transform-origin: top left;
    }
  }
  .feature-cta a {
    display: inline-flex;
    align-items: center;
    padding: 8px 16px;
    border-radius: 30px;
    border: 1px solid none;
    color: var(--vp-button-alt-text);
    background-color: var(--vp-button-alt-bg);
  }
  .feature-cta a:hover {
    border-color: var(--vp-button-alt-hover-border);
    color: var(--vp-button-alt-hover-text);
    background-color: var(--vp-button-alt-hover-bg)
  }
  .action a {
    display: inline-flex !important;
    align-items: center;
  }
  .action a .vpi-social-github,
  .feature-cta a .vpi-social-github,
  .feature-cta a .vpi-electric-icon {
    display: block;
    width: 1.42rem;
    height: 1.42rem;
    margin: 0 0.5rem 0 0;
    position: relative;
  }
  @media (min-width: 768px) and (max-width: 825px) {
    .feature-cta a .vpi-social-github,
    .feature-cta a .vpi-electric-icon {
      width: 1.36rem;
      height: 1.36rem;
      margin-left: -0.2rem;
      margin-right: 0.4rem;
    }
  }

  .feature-cta a .count {
    margin-left: 0.25rem;
    min-width: 55px;
  }

  .home-cta {
    display: flex;
    justify-content: center;
    margin-top: -24px;
  }

  .home-cta div[class*='language-'] {
    display: inline-block;
    max-width: calc(100vw - 48px);
  }

  @media (min-width: 760px) {
    .home-cta div[class*='language-'] code {
      padding-left: 36px !important;
      padding-right: 36px !important;
    }
  }
</style>

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