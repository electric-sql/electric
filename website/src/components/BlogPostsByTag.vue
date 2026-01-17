<script setup lang="ts">
import { computed } from 'vue'
import { data as posts } from '../../data/posts.data.ts'
import BlogPostListing from './BlogPostListing.vue'

interface Post {
  title: string
  path: string
  image: string
  excerpt: string
  tags?: string[]
  authors: string[]
  date: string
}

const props = defineProps<{
  tag: string
  limit?: number
}>()

const filteredPosts = computed(() => {
  const filtered = (posts as Post[]).filter((post) =>
    post.tags && post.tags.includes(props.tag)
  )

  if (props.limit) {
    return filtered.slice(0, props.limit)
  }

  return filtered
})
</script>

<style scoped>
.blog-posts-by-tag {
  margin: 24px 0;
}

.listing {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

@media (max-width: 749px) {
  .listing {
    grid-template-columns: 1fr;
    gap: 20px;
  }
}

.no-posts {
  color: var(--vp-c-text-2);
  font-style: italic;
}
</style>

<template>
  <div class="blog-posts-by-tag">
    <div v-if="filteredPosts.length > 0" class="listing">
      <BlogPostListing
        v-for="post in filteredPosts"
        :key="post.path"
        :post="post"
      />
    </div>
    <p v-else class="no-posts">
      No posts found with this tag.
    </p>
  </div>
</template>
