<script setup>
const { demo } = defineProps(['demo'])
</script>

<template>
  <div class="demo-embed" v-if="demo.image">
    <figure>
      <a v-if="demo.deployed_url" :href="demo.deployed_url" target="_blank">
        <img :src="demo.image" />
      </a>
      <img v-else :src="demo.image" />
      <figcaption v-if="demo.deployed_url">
        See the {{ demo.example ? 'example' : 'demo' }} running at
        <a :href="demo.deployed_url" target="_blank" class="no-wrap-sm">
          {{ demo.deployed_url.split('://').at(1) }}</a
        >
      </figcaption>
    </figure>
  </div>
  <div v-if="demo.deployed_url && !demo.image">
    See the demo running at
    <a :href="demo.deployed_url" target="_blank">
      {{ demo.deployed_url.split('://').at(1) }}</a
    >
  </div>
</template>
