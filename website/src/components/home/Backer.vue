<script setup>
  const { backer } = defineProps(['backer'])
</script>

<style scoped>
  .backer {}
</style>

<template>
  <div class="backer">
    <div class="backer-image">
      <a :href="backer.profile_uri" class="no-visual">
        <img :src="backer.image" />
      </a>
    </div>
    <div class="angel-body">
      <a :href="backer.profile_uri" class="no-visual">
        <h3>
          {{ backer.name }}
        </h3>
        <h4>
          {{ backer.short_bio }}
        </h4>
      </a>
    </div>
  </div>
</template>