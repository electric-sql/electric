---
layout: home
title: 'Postgres Everywhere'
description: 'Your data, in sync, wherever you need it.'
hero:
  name: "Why fetch when"
  text: "you can sync?"
  tagline: >-
    Swap out your queries, data fetching and caching
    for bulletproof sync that just works.
  image:
    src: /img/home/zap-with-halo.svg
  actions:
    - theme: brand
      text: Quickstart
      link: /guides/quickstart
    - theme: alt
      text: >-
        View on GitHub
      target: '_blank'
      link: https://github.com/electric-sql
features:
  - title: Electric Sync Engine
    details: >-
      <span class="para">
        Sync partial replicas of your data into
        <span class="no-wrap">local apps</span>
        <span class="no-wrap">and services</span>.
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
        Load data faster than you can query,
        <span class="no-wrap-lg">scale out to</span>
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
    details: "Lala",
    icon: {
      src: '/img/icons/electric.svg'
    },
    link: '/product/electric'
  }
]

const renderStarCount = async (repoName, initialStarCount) => {
  const linkEl = document.querySelector(`.feature-cta.${repoName}-star-count a`)

  let countEl = linkEl.querySelector('.count')

  if (!countEl) {
    countEl = document.createElement('span')
    countEl.classList.add('count')
    countEl.innerText = `( ${initialStarCount.toLocaleString()} )`;

    const icon = document.createElement('span')
    icon.classList.add('vpi-social-github')
    linkEl.prepend(icon)
  }

  linkEl.append(countEl)

  const count = await getStarCount(repoName, initialStarCount)

  let currentCount = Math.max(count - 15, initialStarCount)

  const animateCount = () => {
    currentCount += 1;

    if (currentCount >= count) {
      currentCount = count;

      clearInterval(intervalId);
    }

    countEl.innerText = `( ${currentCount.toLocaleString()} )`
  }

  const intervalId = setInterval(animateCount, 64)
}

const forceResize = () => {
  const wrapper = document.querySelector('.masonry-wall-wrapper')
  const wall = document.querySelector('.masonry-wall')

  wrapper.style.height = `${wall.offsetHeight * 0.7}px`
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
    const icon = document.createElement('span')
    icon.classList.add('vpi-social-github')

    const action = document.querySelector(
      '.VPHero .actions a[href="https://github.com/electric-sql"]'
    )
    action.prepend(icon)

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
  .feature-cta a {
    display: inline-flex;
    align-items: center;
    padding: 8px 16px;
    border-radius: 30px;
    border: 1px solid none;
    color: var(--vp-button-alt-text);
    background-color: var(--vp-button-alt-bg);
  }
  .feature-cta a:hover, {
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
  .action a .vpi-electric-icon,
  .feature-cta a .vpi-electric-icon {
    --icon: url(./public/img/brand/icon.svg);
  }
  .feature-cta a .count {
    margin-left: 0.25rem;
    min-width: 55px;
  }

  .masonry-wall-wrapper {
    position: relative;
    display: block;

    text-align: center;

    overflow: hidden;

    margin-top: 64px;
  }

  .masonry-wall {
    columns: 4 300px;
    column-gap: 2rem;

    transform: scale(0.7);
    transform-origin: top center;

    margin: 0 -23% -0.43% -23%;
  }
  .masonry-item {
    width: 100%;
    margin: 0;
    display: inline-block;
  }
  .masonry-item .twitter-tweet iframe {
    transform: scale(1);
  }
  @media (max-width: 1015px) {
    .masonry-item.tweet-hide-md {
      display: none;
    }
  }
  @media (max-width: 756px) {
    .masonry-item.tweet-hide-sm {
      display: none;
    }
  }
  .masonry-tweet {
    position: relative;
    display: block;
    margin-bottom: 64px;
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

<div class="vp-doc">
  <div class="container">
    <div class="features-content your-stack-simplified">
      <HomeYourStackSimplified />
    </div>
  </div>
</div>

<VPFeatures
    class="VPHomeFeatures"
    :features="propositions"
/>