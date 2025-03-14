<script setup>
  const { target } = defineProps(['target'])

  const icon = `/img/home/sync-targets/${target.slug}.svg`
</script>

<template>
  <a class="card no-visual"><!-- :href="target.href"  -->
    <div class="icon">
      <img :src="icon" />
    </div>
    <div class="body">
      <h3>
        {{ target.name }}
      </h3>
      <p v-html="target.description"></p>
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
    padding: 40px var(--padding-width) 20px;
  }
  .icon img {
    width: calc(2 * var(--padding-width));
    height: calc(2 * var(--padding-width));
  }
  .body {
    position: relative;
    display: block;
    padding: 0px calc(var(--padding-width) - var(--extra-padding-width)) 32px var(--padding-width);
    background: var(--vp-c-bg-soft);
  }
  .body h3 {
    margin: 0 0 0.65rem 0;
  }
  .body p {
    position: relative;
    display: block;
    margin: 0;
    opacity: 0.92;
    font-size: 14px;
    line-height: 24px;
    font-weight: 500 !important;
    max-width: 320px;
  }
</style>
