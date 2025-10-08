<script setup>
import BlogPostListing from "../../BlogPostListing.vue"
import BlueskyPosts from "../BlueskyPosts.vue"
import Section from "../Section.vue"

import { data } from "../../../../data/posts.data.ts"
const posts = data.filter((post) => post.homepage !== false).slice(0, 4)

const actions = [
  {
    href: "https://dashboard.electric-sql.cloud/",
    text: "Subscribe",
    theme: "brand",
  },
  {
    href: "/blog",
    text: "Blog",
  },
  {
    href: "https://bsky.app/profile/electric-sql.com",
    text: "Follow",
  },
]
</script>

<style scoped>
.listing {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  margin: 48px 0px;
  overflow: hidden;
}
@media (max-width: 1049px) {
  .listing {
    grid-template-columns: 1fr 1fr;
  }
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
  }
}

.listing :deep(.post-body h3) {
  font-size: 18px;
  color: var(--vp-c-text-1);
  font-weight: 500;
}

.listing :deep(p.post-author span) {
  color: var(--vp-c-text-2);
}

.listing :deep(.post-body > p) {
  font-size: 14px;
  line-height: 24px;
  color: var(--vp-c-text-3);
}
</style>

<template>
  <Section :actions="actions">
    <template #title> Latest news and updates </template>
    <template #tagline>
      Subscribe to the
      <a href="/blog">Electric Blog</a> for the latest news and updates.
    </template>
    <div class="listing">
      <BlogPostListing v-for="post in posts" :key="post.slug" :post="post" />
    </div>
    <template #outline>
      Follow
      <a href="https://bsky.app/profile/electric-sql.com"> @electric-sql.com</a>
      on Bluesky and&nbsp;<a href="https://x.com/ElectricSQL"> @ElectricSQL</a>
      on X:
    </template>
    <template #outbody>
      <BlueskyPosts did="did:plc:kuwyhfwegvfzugctjd6cwrlg" :limit="2" />
    </template>
  </Section>
</template>
