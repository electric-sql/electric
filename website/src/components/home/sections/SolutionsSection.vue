<script setup>
import { data } from '../../../../data/posts.data.ts'
import LandscapeBlogPostListing from '../../LandscapeBlogPostListing.vue'
import Section from '../Section.vue'

const posts = data
  .filter((post) => post.homepageSolution)
  .sort((a, b) => parseInt(a.homepageOrder) - parseInt(b.homepageOrder))

const actions = [
  {
    href: '/cloud',
    text: 'Data platform',
    theme: 'brand',
  },
  {
    href: '/sync',
    text: 'Why sync?',
  },
]
</script>

<template>
  <br />
  <Section :actions="actions">
    <template #title
      >Build collaborative,<br class="hidden-md inline-sm" />
      <span class="no-wrap">multi-agent systems</span></template
    >
    <template #tagline>
      With a reactive data platform designed for
      <span class="no-wrap-xs"> multi-user, multi-agent collaboration</span>
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
  .solutions-grid .post {
    max-width: 511px;
    margin: auto;
  }
}
</style>
