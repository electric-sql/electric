<script setup>
  const {
    body,
    href,
    icon,
    title
  } = defineProps([
    'body',
    'href',
    'icon',
    'title'
  ])
</script>

<template>
  <a class="no-visual" :href="href">
    <div class="card">
      <slot name="override_contents">
        <div v-if="icon" class="icon">
          <img :src="icon" />
        </div>
        <div class="body">
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

<style scoped>
  .card {
    position: relative;
    display: block;
    border-radius: 12px;
    background-color: var(--vp-c-bg-soft);
    border: 1px solid #2a2c34;

    --padding-width: 32px;
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
  .icon {
    padding: 40px var(--padding-width) 0px;
  }
  .icon img {
    width: calc(2 * var(--padding-width));
    height: calc(2 * var(--padding-width));
  }
  .body {
    position: relative;
    display: block;
    padding: 32px calc(var(--padding-width) - var(--extra-padding-width)) 32px var(--padding-width);
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
