<script setup>
  const { demo } = defineProps(['demo'])
</script>

<template>
  <div class="actions cta-actions page-footer-actions left">
    <div class="action" v-if="demo.deployed_url">
      <VPButton :href="demo.deployed_url"
          theme="brand"
          text="Open demo"
          target="_blank"
      />
    </div>
    <div class="action" v-if="demo.source_url">
      <VPButton :href="demo.source_url"
          :theme="demo.deployed_url ? 'alt' : 'brand'"
          text="View on GitHub"
          target="_blank"
      />
    </div>
  </div>
</template>
