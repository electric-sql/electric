---
layout: home
title: 'ElectricSQL'
titleTemplate: 'Postgres Sync'
description: 'Your data, in sync, wherever you need it.'
hero:
  name: "Why fetch when"
  text: "you can sync?"
  tagline: >-
    Swap out your queries, data fetching and caching for bulletproof sync<span class="hidden-xs"> that just works</span>.
  image:
    src: /img/home/zap-with-halo.svg
  actions:
    - theme: brand
      text: Quickstart
      link: /guides/quickstart
    - theme: alt
      text: >-
        Star on GitHub
      target: '_blank'
      link: https://github.com/electric-sql
features:
  - title: Electric Sync Engine
    details: >-
      <span class="para">
        Sync little subsets of your Postgres data into
        local&nbsp;apps and&nbsp;services.
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
import Tweet from 'vue-tweet'

import VPFeatures from 'vitepress/dist/client/theme-default/components/VPFeatures.vue'

import { data as initialStarCounts } from './count.data.ts'
import { getStarCount } from './components/starCount.ts'

import HomeYourStackSimplified from '.vitepress/theme/home-your-stack-simplified.md'
import HomeCTA from '.vitepress/theme/home-cta.md'

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

const propositions = [
  {
    title: "Solves state transfer",
    details: `
      <p>
        Replace APIs, data fetching and network error handling
        with automated data synchronisation.
      </p>
      <p class="benefits">
        → Simplifies your code<br />
        → No more loading spinners
      </p>
    `,
    image: '/img/home/state-transfer-trans.png'
  },
  {
    title: "Solves cache invalidation",
    details: `
      <p>
        Replace ttls and expiry policies with realtime sync
        and automated invalidation.
      </p>
      <p class="benefits">
        → Simplifies your stack<br />
        → No more stale data
      </p>
    `,
    image: '/img/home/cache-invalidation-trans.png'
  },
  {
    title: "Solves scaling",
    details: `
      <p>
        Take the query workload off your database and the
        compute workload off your cloud.
      </p>
      <p class="benefits">
        → Simplifies your infra<br />
        → Reduces your cloud bill
      </p>
    `,
    image: '/img/home/scalability-trans.png'
  },
  {
    title: "Solves availability",
    details: `
      <p>
        Take the network off the interaction path and build
        systems that are resilient and work offline by design.
      </p>
      <p class="benefits">
        → Simplifies your ops<br />
        → Improves your sleep
      </p>
    `,
    image: '/img/home/high-availability-trans.png'
  }
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

const forceResize = () => {
  const wrapper = document.querySelector('.masonry-wall-wrapper')
  const wall = document.querySelector('.masonry-wall')

  wrapper.style.height = `${wall.offsetHeight * 0.75}px`
}

const finishResize = () => {
  forceResize()

  window.setTimeout(forceResize, 6_000)
  window.setTimeout(forceResize, 12_000)
  window.setTimeout(forceResize, 20_000)
}

let resizeTimer
const handleResize = () => {
  forceResize()

  clearTimeout(loadTimer)
  loadTimer = setTimeout(finishResize, 2_000)
}

let loadTimer
const handleTweetLoad = () => {
  clearTimeout(loadTimer)
  loadTimer = setTimeout(handleResize, 600)
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

    let resizeTimer
    window.addEventListener('resize', (event) => {
      clearTimeout(resizeTimer)

      resizeTimer = setTimeout(handleResize, 300)
    })
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

  .action a .vpi-electric-icon,
  .feature-cta a .vpi-electric-icon {
    --icon: url(/img/brand/icon.svg);
  }
  .feature-cta a .count {
    margin-left: 0.25rem;
    min-width: 55px;
  }

  .masonry-wall-wrapper {
    position: relative;
    display: block;

    text-align: center;

    overflow-y: hidden;
    overflow-x: show;

    margin-top: 64px;
  }

  .masonry-wall {
    columns: 4 300px;
    column-gap: 1.5rem;

    transform: scale(0.75);
    transform-origin: top center;

    margin: 0 -16.66% -0.33% -16.66%;
  }
  .masonry-item {
    width: 100%;
    max-width: 462px;
    margin: 0;
    display: inline-block;
  }
  .masonry-item .twitter-tweet iframe {
    transform: scale(1);
  }
  @media (max-width: 1082px) {
    .masonry-item.tweet-hide-md {
      display: none;
    }
  }
  @media (max-width: 807px) {
    .masonry-item.tweet-hide-sm {
      display: none;
    }
  }
  .masonry-tweet {
    position: relative;
    display: block;
    filter: saturate(0.75);
  }
  .loading-tweet {
    border: 1px solid rgba(238 238 238 0.8);
    border-radius: 5px;
    background: rgba(23 32 42, 0.8);
    min-height: 200px;
    min-width: 200px;
    width: 100%;
    position: relative;
    display: block;
  }

  .home-propositions {
    text-align: center;
    margin: 32px 0;
  }
  .home-propositions .proposition {
    display: inline-flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    margin: 15px 0;
    gap: 24px;

    border: 1px solid var(--vp-c-bg-soft);
    border-radius: 12px;
    background-color: var(--vp-c-bg-soft);
    transition: border-color 0.25s, background-color 0.25s;
    padding: 12px;
  }
  @media (min-width: 560px) {
    .home-propositions .proposition {
      padding: 14px 24px;
    }
  }
  @media (min-width: 760px) {
    .home-propositions .proposition {
      padding: 18px 36px;
    }
  }
  @media (min-width: 1024px) {
    .home-propositions .proposition {
      padding: 24px 48px;
    }
  }

  .home-propositions .proposition-image {
    width: 30vw;
    max-width: 320px;
    min-width: 180px;
  }
  .home-propositions .proposition-image img {
    width: 100%;
    filter: drop-shadow(1px 2px calc(2px + 0.5vw) var(--vp-c-indigo-1));
  }
  .home-propositions .proposition-content {
    width: 40vw;
    max-width: 460px;
    min-width: 180px;
    text-align: left;
  }
  .home-propositions .proposition-content h3 {
    border: none;
    margin-top: 12px;
    padding-top: 0;
    font-size: 24px;
  }
  .home-propositions .proposition-content p {
    font-weight: 550;
    font-size: 15px;
    color: var(--vp-c-text-2);
  }
  .home-propositions .proposition-content .benefits {
    margin-bottom: 6px;
    color: var(--vp-c-text-1);
  }
  @media (max-width: 759px) {
    .home-propositions .proposition {
      flex-direction: column;
    }
    .home-propositions .proposition-image {
      width: 50vw;
      max-width: none;
      min-width: none;
    }
    .home-propositions .proposition-content {
      width: 100%;
      max-width: 400px;
      min-width: none;
      text-align: center;
    }
    .home-propositions .proposition-content h3 {
      margin-top: -12px;
    }
  }
  @media (max-width: 759px) {
    .home-propositions .proposition-content p {
      font-size: 14.5px;
    }
    .home-propositions .proposition-content .benefits {
      margin-bottom: 24px;
    }
  }
  @media (max-width: 559px) {
    .home-propositions .proposition-content p {
      font-size: 14px;
    }
  }


  .home-cta {
    display: flex;
    justify-content: center;
    margin-top: -24px;
  }

  .home-cta .actions {
    display: flex;
    gap: 12px;
    margin: 24px 0;
    justify-content: center;
  }
</style>

<div class="masonry-wall-wrapper">
  <div class="masonry-wall">
    <div v-for="(item, index) in tweets" :key="item.id"
        :class="{
            'masonry-item': true,
            'tweet-hide-md': item.hideMedium,
            'tweet-hide-sm': item.hideSmall
          }">
      <div class="masonry-tweet">
        <Tweet :tweet-id="item.id"
            align="center"
            conversation="none"
            theme="dark"
            dnt
            @tweet-load-error="handleTweetLoad"
            @tweet-load-success="handleTweetLoad">
          <template v-slot:loading>
            <div class="loading-tweet"></div>
          </template>
        </Tweet>
      </div>
    </div>
  </div>
</div>

<div class="features-content your-stack-simplified">
  <HomeYourStackSimplified />
</div>

<div class="home-propositions">
  <div v-for="(item, index) in propositions" :key="item.id"
      class="proposition">
    <div class="proposition-image">
      <img :src="item.image" />
    </div>
    <div class="proposition-content">
      <h3>
        {{ item.title }}
      </h3>
      <p v-html="item.details" />
    </div>
  </div>
</div>

<div class="features-content">
  <div class="home-cta">
    <HomeCTA />
  </div>
</div>