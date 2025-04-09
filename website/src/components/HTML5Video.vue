<script setup>
  const { poster, src } = defineProps(['poster', 'src'])

  const baseUrl = window?.location?.origin || ''
</script>

<template>
  <video controls preload="auto" :poster="`${baseUrl}${poster}`">
    <source :src="src" />
  </video>
</template>
