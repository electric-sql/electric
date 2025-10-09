<script setup>
import { onMounted } from 'vue'

const { demo } = defineProps(['demo'])
</script>

<template>
  <div class="demo-card" target="_blank">
    <a :href="demo.link" class="no-visual">
      <img :src="demo.listing_image || demo.image" />
    </a>
    <div class="demo-description">
      <a :href="demo.link" class="no-visual">
        <h3>{{ demo.title }}</h3>
      </a>
      <p>{{ demo.description }}</p>
      <ul class="actions demo-actions">
        <li v-if="demo.deployed_url" class="feature-cta">
          <VPButton
            :href="demo.deployed_url"
            text="Open demo"
            theme="brand"
            target="_blank"
          />
        </li>
        <li v-if="demo.source_url" class="feature-cta">
          <VPButton
            :href="demo.source_url"
            text="Source code"
            theme="alt"
            target="_blank"
          />
        </li>
      </ul>
    </div>
  </div>
</template>
