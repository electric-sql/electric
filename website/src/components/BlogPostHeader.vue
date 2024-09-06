<script setup>
import { useData } from 'vitepress'

import { data as authors } from '../../data/authors.data.ts'

const { page, frontmatter } = useData()

const parts = page._value.filePath.split('blog/posts/')[1].split('-')
const postDate = `${parts[0]}-${parts[1]}-${parts[2]}`
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
    align-items: center;
    color: var(--vp-c-text-2);
    font-size: 15px;
    min-width: 360px;
    overflow: hidden;
  }
  .date {
    color: var(--vp-c-text-2);
    font-size: 15px;
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
    <p class="post-author">
      <a v-for="(slug, index) in frontmatter.authors"
          :href="('/about/team#' + slug)"
          class="no-visual"
          :style="{marginLeft: index > 0 ? '-20px' : '0'}">
        <img :src="authors[slug].image" />
      </a>
      <span>By&nbsp;</span>
      <a v-for="(slug, index) in frontmatter.authors"
          :href="('/about/team#' + slug)"
          class="no-visual">
        <span>{{ authors[slug].name }}<span v-if="index === frontmatter.authors.length - 1">&nbsp;</span><span v-if="index < frontmatter.authors.length - 1"><span v-if="index < frontmatter.authors.length - 2">,&nbsp;</span><span v-else>&nbsp;and&nbsp;</span></span></span>
      </a>
      <span class="date hidden-sm"
          :style="{display: frontmatter.authors.length === 1 ? 'inline-block !important' : ''}">
        on {{ new Date(postDate).toLocaleDateString() }}.
      </span>
    </p>
    <div class="date block-sm" :style="{display: frontmatter.authors.length === 1 ? 'none !important' : ''}">
      Published on {{ new Date(postDate).toLocaleDateString() }}
    </div>
    <hr />
  </div>
</template>