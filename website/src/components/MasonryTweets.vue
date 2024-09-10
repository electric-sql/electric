<script setup>
import { onMounted } from 'vue'
import Tweet from 'vue-tweet'

const { columns, tweets } = defineProps(['columns', 'tweets'])

const forceResize = () => {
  const wrapper = document.querySelector('.masonry-wall-wrapper')

  if (!wrapper) {
    return
  }

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

  const wrapper = document.querySelector('.masonry-wall-wrapper')
  wrapper.classList.add('visible')
}

onMounted(async () => {
  if (typeof window !== 'undefined' && document.querySelector) {
    let resizeTimer
    window.addEventListener('resize', (event) => {
      clearTimeout(resizeTimer)

      resizeTimer = setTimeout(handleResize, 300)
    })
  }
})
</script>

<style scoped>
  .twitter-tweet {
    margin: 1rem auto -95px !important;
  }
  .twitter-tweet iframe {
    transform: scale(0.8);
    transform-origin: top left;
  }
  .masonry-wall-wrapper {
    position: absolute;
    display: block;
    margin-left: 20000;

    text-align: center;

    overflow-y: hidden;
    overflow-x: show;

    margin-top: 64px;
  }
  .masonry-wall-wrapper.visible {
    position: relative;
    margin-left: auto;
  }

  .masonry-wall {
    column-gap: 1.5rem;

    transform: scale(0.75);
    transform-origin: top center;

    margin: 0 -16.66% -0.33% -16.66%;
  }
  .masonry-item {
    width: 100%;
    max-width: 462px;
    margin: 0;
    display: block;
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
</style>

<template>
  <div class="masonry-wall-wrapper">
    <div class="masonry-wall" :style="{'columns': columns || '4 300px'}">
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
              :dnt="(true)"
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
</template>