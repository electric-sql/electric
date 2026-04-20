<script setup>
import LandscapeBlogPostListing from '../../LandscapeBlogPostListing.vue'
import Section from '../Section.vue'

import { data } from '../../../../data/posts.data.ts'
const posts = data.filter((post) => post.homepage !== false).slice(0, 4)

const actions = [
  {
    href: '/blog',
    text: 'Electric Blog',
    theme: 'brand',
  },
  {
    href: 'https://x.com/ElectricSQL',
    text: 'Follow @ElectricSQL',
    classes: 'hidden-xs',
  },
  {
    href: 'https://x.com/ElectricSQL',
    text: 'Follow',
    classes: 'block-xs',
  },
]
</script>

<style scoped>
.listing {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin: 48px 0px;
}
@media (max-width: 949px) {
  .listing {
    margin: 36px 0px;
  }
}
@media (max-width: 749px) {
  .listing {
    margin: 32px 0px;
    grid-template-columns: 1fr;
    gap: 16px;
  }
}
</style>

<template>
  <Section :actions="actions">
    <template #title>
      Latest <span class="hidden-sm">news and</span> updates</template
    >
    <template #tagline>
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
  </Section>
</template>
