<script setup>
  const {
    background,
    body,
    href,
    icon,
    image,
    title
  } = defineProps([
    'background',
    'body',
    'href',
    'icon',
    'image',
    'title'
  ])
</script>

<style scoped>
  .card {
    position: relative;
    display: block;
    border-radius: 12px;
    background-color: var(--vp-c-bg-soft);
    border: 1px solid rgba(42, 44, 52, 0.5);

    overflow: hidden;

    --padding-width: 32px;
    --padding-height: 32px;
    --extra-padding-width: 0px;
  }
  @media (min-width: 1020px) and (max-width: 1099px) {
    .card {
      --padding-width: 24px;
    }
  }
  @media (min-width: 960px) and (max-width: 1019px) {
    .card {
      --padding-width: 20px;
      --extra-padding-width: 4px;
    }
  }
  @media (min-width: 960px) and (max-width: 989px) {
    .card {
      --extra-padding-width: 8px;
    }
  }
  @media (max-width: 518px) {
    .card {
      --padding-height: 19px;
      --padding-width: 24px;
      --extra-padding-width: 0px;
    }
    .body :deep(h3) {
      margin-bottom: 0.5rem !important;
    }
    .body :deep(p) {
      margin-top: 8px;
    }
  }
  .image {
    padding: 0;
  }
  .image img {
    width: 100%;
  }
  .icon {
    padding:
      calc(var(--padding-height) + 8px)
      var(--padding-width)
      4px;
  }
  .icon img {
    /*width: calc(2 * var(--padding-width));
    height: calc(2 * var(--padding-width));*/
    width: calc(33px + 1.5vw);
    height: calc(33px + 1.5vw);
  }
  .body {
    position: relative;
    display: block;
    padding:
      var(--padding-height)
      calc(var(--padding-width) - var(--extra-padding-width))
      calc(var(--padding-height) - 4px)
      var(--padding-width);
    background: var(--vp-c-bg-soft);
  }
  .body :deep(h3) {
    margin: -12px 0 0.65rem 0;
  }
  .body :deep(p) {
    position: relative;
    display: block;
    margin: 0;
    opacity: 0.92;
    font-size: 14px;
    line-height: 24px;
    font-weight: 500 !important;
    max-width: 320px;

    color: var(--vp-c-text-2);
    font-weight: 500;
  }
</style>

<template>
  <a class="no-visual" :href="href">
    <div class="card" :style="{
        backgroundColor: background ? background : 'var(--vp-c-bg-soft)'
      }">
      <slot name="override_contents">
        <div v-if="image" class="image">
          <img :src="image" />
        </div>
        <div v-if="icon" class="icon">
          <img :src="icon" />
        </div>
        <div class="body" :style="{
            backgroundColor: background ? background : 'var(--vp-c-bg-soft)'
          }">
          <h3 v-if="title">
            {{ title }}
          </h3>
          <p v-if="body" v-html="body"></p>
          <slot></slot>
        </div>
      </slot>
    </div>
  </a>
</template>

