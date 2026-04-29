<script setup lang="ts">
import { computed } from 'vue'
import { getVitepressData } from '../lib/vitepressData'
import type { PostListRow } from '../types/data-loaders'
import * as postsModule from '../../data/posts.data'
import BlogPostListing from './BlogPostListing.vue'
import MarkdownContent from './MarkdownContent.vue'
import MdExportExplicit from './MdExportExplicit.vue'
import { useMarkdownExport } from '../lib/useMarkdownExport'

const allPosts = getVitepressData<PostListRow[]>(postsModule)

const props = defineProps<{
  tag: string
  limit?: number
}>()

const filteredPosts = computed(() => {
  const filtered = allPosts.filter((post) => {
    if (!Array.isArray(post.tags)) return false
    return post.tags.some((t) => String(t) === props.tag)
  })

  if (props.limit) {
    return filtered.slice(0, props.limit)
  }

  return filtered
})

const filteredMarkdown = computed(() =>
  filteredPosts.value
    .map((post) => `- [${post.title}](${post.path})`)
    .join('\n')
)

const isMarkdownExport = useMarkdownExport()
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
  <MdExportExplicit v-if="isMarkdownExport && filteredPosts.length > 0">
    <MarkdownContent>{{ filteredMarkdown }}</MarkdownContent>
  </MdExportExplicit>
  <div v-else class="blog-posts-by-tag">
    <div v-if="filteredPosts.length > 0" class="listing">
      <BlogPostListing
        v-for="post in filteredPosts"
        :key="post.path"
        :post="post"
      />
    </div>
    <p v-else class="no-posts">No posts found with this tag.</p>
  </div>
</template>
