<script setup>
const { link, subtitle, description, background } = defineProps([
  'link',
  'subtitle',
  'description',
  'background',
])
</script>

<style scoped>
.banner {
  color: var(--vp-c-text-1);
  border-bottom: 1px solid var(--vp-c-indigo-2);
  font-weight: 500;

  padding: 22px 20px 17px;
  margin-bottom: 2px;

  font-size: 15px;
  text-align: center;
}
.banner a {
  padding: 18px 24px;
}
.banner a:hover {
  color: var(--vp-c-indigo-1);
}
@media (max-width: 559px) {
  .banner {
    font-size: 14.75px;
  }
  .banner a {
    padding: 18px;
  }
}
@media (max-width: 449px) {
  .banner {
    font-size: 14px;
  }
  .banner a {
    padding: 18px 0px;
  }
}
</style>

<template>
  <div class="banner" :style="{ background: background }">
    <div class="container">
      <div
        style="
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        "
      >
        <a :href="link" style="display: inline-flex; align-items: center">
          <slot name="icon"></slot>
          <slot name="title"></slot>
        </a>
        <span>&ndash;</span>
        <span class="inline-md">
          {{ subtitle }}
        </span>
        <span class="hidden-md">
          {{ description }}
        </span>
      </div>
    </div>
  </div>
</template>

<style>
.nav-relative .VPNav {
  position: relative !important;
}
</style>
