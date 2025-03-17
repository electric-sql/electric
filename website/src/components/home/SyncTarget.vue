<script setup>
  import Card from './Card.vue'

  const { target } = defineProps(['target'])
  const { body, href, title } = target

  const icon = `/img/home/sync-targets/${target.slug}.svg`
</script>

<style scoped>
  @media (max-width: 767px) {
    .sync-target {
      position: relative;
      display: block;
      width: 100%;
      max-width: 340px;
      margin: 0 auto;
    }
  }
</style>

<template>
  <div class="sync-target">
    <Card :href="href" :icon="icon" :title="title" :body="body" />
  </div>
</template>
