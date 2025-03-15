<script setup>
  import Card from './Card.vue'

  const { target } = defineProps(['target'])
  const { body, href, title } = target

  const icon = `/img/home/sync-targets/${target.slug}.svg`
</script>

<template>
  <Card :href="href" :icon="icon" :title="title" :body="body" />
</template>
