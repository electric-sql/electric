<script setup lang="ts">
/* CuratedBlogPosts — section-scoped panel of blog post cards.
   ──────────────────────────────────────────────────────────
   Sections (Streams, Sync, Cloud, Agents) curate their own short
   list of related posts using ONE of two inputs:

     posts: string[]   — explicit, ordered list of slugs (the
                          `slug` portion of the blog filename, e.g.
                          `fork-branching-for-durable-streams`).
                          Renders posts in the exact order provided.

     tags:  string[]   — fallback selector. Any blog post that has
                          at least one of these tags is eligible;
                          posts are ordered by date (newest first).

   `limit` caps the number rendered (default 4). Layout is a 2×2
   grid of `LandscapeBlogPostListing` cards on desktop, single
   column on mobile, matching the homepage `LatestNewsSection`. */

import { computed } from "vue"
import { data as allPosts } from "../../data/posts.data.ts"
import LandscapeBlogPostListing from "./LandscapeBlogPostListing.vue"

const props = withDefaults(
  defineProps<{
    posts?: string[]
    tags?: string[]
    limit?: number
  }>(),
  { limit: 4 }
)

const curated = computed(() => {
  if (props.posts && props.posts.length) {
    const ordered: any[] = []
    for (const slug of props.posts) {
      const post = allPosts.find(
        (p: any) =>
          typeof p.path === "string" && p.path.endsWith(`/${slug}`)
      )
      if (post) ordered.push(post)
    }
    return ordered.slice(0, props.limit)
  }
  if (props.tags && props.tags.length) {
    const wanted = new Set(props.tags.map((t) => t.toLowerCase()))
    return allPosts
      .filter(
        (p: any) =>
          Array.isArray(p.tags) &&
          p.tags.some((t: string) =>
            wanted.has(String(t).toLowerCase())
          )
      )
      .slice(0, props.limit)
  }
  return []
})
</script>

<template>
  <div v-if="curated.length" class="curated-posts">
    <LandscapeBlogPostListing
      v-for="post in curated"
      :key="post.path"
      :post="post"
    />
  </div>
</template>

<style scoped>
/* 2-up grid mirrors the homepage `LatestNewsSection` rhythm — the
   landscape post card has an image-then-text layout that reads
   poorly at 3+ columns. Two columns × two rows keeps the cards
   feeling substantial without crowding the text panel. */
.curated-posts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
  margin: 8px 0;
}

@media (max-width: 749px) {
  .curated-posts {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}
</style>
