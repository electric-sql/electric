<script setup>
const { poster, src } = defineProps(["poster", "src"])

const baseUrl = import.meta.env.SSR ? "" : window.location.origin
</script>

<template>
  <video controls preload="auto" :poster="`${baseUrl}${poster}`">
    <source :src="src" />
  </video>
</template>
