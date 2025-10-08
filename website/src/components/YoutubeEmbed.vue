<script setup>
const { videoId } = defineProps(["videoId"])

const src = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`
</script>

<template>
  <iframe
    :src="src"
    allow="encrypted-media; fullscreen; picture-in-picture"
    class="youtube-embed"
    sandbox="allow-presentation allow-same-origin allow-scripts"
  >
  </iframe>
</template>
