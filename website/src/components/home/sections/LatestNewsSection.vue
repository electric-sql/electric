<script setup>
import EaSection from '../../agents-home/Section.vue'
import LandscapeBlogPostListing from '../../LandscapeBlogPostListing.vue'

import { data } from '../../../../data/posts.data.ts'
const posts = data.filter((post) => post.homepage !== false).slice(0, 4)
</script>

<template>
  <EaSection :dark="true">
    <template #title>
      Latest <span class="hidden-sm">news and</span>&nbsp;updates
    </template>
    <template #subtitle>
      Subscribe to the
      <a href="/blog">Electric Blog</a>
    </template>
    <div class="listing">
      <LandscapeBlogPostListing
        v-for="post in posts"
        :key="post.slug"
        :post="post"
      />
    </div>
    <template #actions>
      <VPButton
        tag="a"
        size="medium"
        theme="brand"
        text="Electric Blog"
        href="/blog"
      />
      <VPButton
        tag="a"
        size="medium"
        theme="alt"
        text="Follow @ElectricSQL"
        href="https://x.com/ElectricSQL"
        class="hidden-xs"
      />
      <VPButton
        tag="a"
        size="medium"
        theme="alt"
        text="Follow"
        href="https://x.com/ElectricSQL"
        class="block-xs"
      />
    </template>
  </EaSection>
</template>

<style scoped>
.listing {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin: 8px 0px;
}
@media (max-width: 749px) {
  .listing {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}
</style>
