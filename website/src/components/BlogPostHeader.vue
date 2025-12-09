<script setup>
import { useData } from 'vitepress'
import { computed } from 'vue'

import { data as authors } from '../../data/authors.data.ts'

const { page, frontmatter } = useData()

const postDate = computed(() => {
  const parts = page.value.filePath.split('blog/posts/')[1].split('-')
  return `${parts[0]}-${parts[1]}-${parts[2]}`
})
</script>

<style scoped>
.post-image {
  margin-top: -2px !important;
  margin-bottom: 32px;
}
@media (max-width: 559px) {
  .post-image {
    margin-top: -14px !important;
    margin-bottom: 24px !important;
  }
}

.post-author {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  color: var(--vp-c-text-2);
  font-size: 15px;
  gap: 0.5rem;
}
.date {
  color: var(--vp-c-text-2);
  font-size: 15px;
  white-space: nowrap;
}
.author-avatars {
  display: flex;
  margin-right: 0.2rem;
}
.author-names {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}
.post-author img {
  width: 42px;
  border-radius: 21px;
  margin-right: 0.7rem;
}
.post-author a,
.post-author > span {
  display: inline-block;
}
</style>

<template>
  <div class="post-header">
    <p class="post-image">
      <img :src="frontmatter.image" />
    </p>
    <h1>
      {{ frontmatter.title }}
    </h1>
    <div class="post-author">
      <div class="author-avatars">
        <a
          v-for="(slug, index) in frontmatter.authors"
          :key="slug"
          :href="'/about/team#' + slug"
          class="no-visual"
          :style="{ marginLeft: index > 0 ? '-20px' : '0' }"
        >
          <img :src="authors[slug].image" />
        </a>
      </div>
      <div class="author-names">
        <span>By&nbsp;</span>
        <a
          v-for="(slug, index) in frontmatter.authors"
          :key="slug"
          :href="'/about/team#' + slug"
          class="no-visual"
        >
          <span>{{ authors[slug].name
          }}<span v-if="index < frontmatter.authors.length - 1"
            ><span v-if="index < frontmatter.authors.length - 2">,&nbsp;</span
            ><span v-else>&nbsp;and&nbsp;</span></span
          ></span>
        </a>
        <ClientOnly>
          <span class="date">
            &nbsp;on {{ new Date(postDate).toLocaleDateString() }}.
          </span>
        </ClientOnly>
      </div>
    </div>
    <hr />
  </div>
</template>
