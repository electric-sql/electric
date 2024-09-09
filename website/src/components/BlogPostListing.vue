<script setup>
  import { data as authors } from '../../data/authors.data.ts'

  const { post } = defineProps(['post'])
</script>

<style scoped>
  .post {
    margin: 12px 0;

    border-radius: 12px;
    background-color: var(--vp-c-bg-soft);
  }
  .post:hover {
    border-color: var(--ddn-color);
  }

  .post a {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;

    width: 100%;
    min-height: 100%;
  }

  .post img {
    border-top-left-radius: 12px;
    border-top-right-radius: 12px;
  }
  .post-image img {
    width: 448px;
    height: 254px;
    object-fit: cover;
    min-width: 100%;
  }
  @media (min-width: 750px) and (max-width: 949px) {
    .post-image img {
      width: 336px;
      height: 191px;
    }
  }
  @media (max-width: 549px) {
    .post-image img {
      width: 336px;
      height: 191px;
    }
  }
  .post-body {
    padding: 0px 24px 0px;
    flex-grow: 1;
  }
  .post-body h3 {
    font-size: 22px;
  }
  .post-body p {
    color: var(--vp-c-text-2);
    font-size: 15px;
    line-height: 1.8;
  }

  .post-body p.post-author {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    color: var(--vp-c-text-1);
    font-size: 14px;
  }
  .post-author img {
    width: 32px;
    border-radius: 16px;
    margin-right: 0.5rem;
  }

  .post-footer {
    position: relative;
    display: block;

    border-top: 1px solid rgb(46, 46, 50);
    color: var(--vp-c-indigo-1);

    padding: 18px 0 36px;
    margin: 6px 24px 0;
  }

</style>

<template>
  <div class="post">
    <a :href="post.path" class="no-visual">
      <div class="post-image">
        <img :src="post.image"
            width="1530"
            height="874"
        />
      </div>
      <div class="post-body">
        <h3>
          {{ post.title }}
        </h3>
        <p class="post-author">
          <img :src="(authors[post.authors[0]].image)" />
          <span>
            {{ authors[post.authors[0]].name }}
          </span>
        </p>
        <p v-html="post.excerpt" />
      </div>
      <div class="post-footer">
        Read post →
      </div>
    </a>
  </div>
</template>