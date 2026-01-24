<script setup>
import { data } from '../../../../data/posts.data.ts'
import LandscapeBlogPostListing from '../../LandscapeBlogPostListing.vue'
import Section from '../Section.vue'

const posts = data
  .filter((post) => post.homepageSolution)
  .sort((a, b) => parseInt(a.homepageOrder) - parseInt(b.homepageOrder))

const actions = [
  {
    href: '/sync',
    text: 'Why sync',
    theme: 'brand',
  },
  {
    href: '/sync#solutions',
    text: 'Solutions',
  },
]
</script>

<template>
  <br />
  <Section :actions="actions">
    <template #title>Unlock&nbsp;collaboration, unlock&nbsp;adoption</template>
    <template #tagline>
      Sync is the magic behind fast apps and the key to collaborative&nbsp;AI
    </template>
    <div class="solutions-grid">
      <LandscapeBlogPostListing
        v-for="post in posts"
        :key="post.slug"
        :post="post"
      />
    </div>
  </Section>
</template>

<style scoped>
.solutions-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
  margin: 36px 0px 42px;
  align-items: stretch;
}

@media (max-width: 768px) {
  .solutions-grid {
    grid-template-columns: 1fr;
    gap: 20px;
  }
}
</style>
