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
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    color: var(--vp-c-text-1);
    font-size: 15px;
  }
  .post-author img {
    width: 42px;
    border-radius: 21px;
    margin-right: 0.7rem;
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
    <p class="post-author" v-for="slug in frontmatter.authors">
      <a :href="('/about/team#' + slug)" class="no-visual">
        <img :src="authors[slug].image" />
      </a>
      <a :href="('/about/team#' + slug)" class="no-visual">
        <span>
          by {{ authors[slug].name }}
        </span>
      </a>
      <span>
        &nbsp;on {{ new Date(postDate).toLocaleDateString() }}.
      </span>
    </p>
  </div>
</template>