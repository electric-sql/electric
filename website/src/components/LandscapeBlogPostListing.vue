<script setup>
import { Image } from '@unpic/vue'

const fallback = import.meta.env.DEV ? undefined : 'netlify'

const { post } = defineProps(['post'])
</script>

<style scoped>
.post {
  border-radius: 12px;
  background-color: var(--vp-c-bg-soft);
  border: 1px solid rgba(42, 44, 52, 0.5);
}

.post a {
  position: relative;
  display: flex;
  flex-direction: row;
  width: 100%;
  min-height: 100%;
}

.post-image {
  flex-shrink: 0;
}

.post-image img {
  border-top-left-radius: 12px;
  border-bottom-left-radius: 12px;
  width: min(calc(40px + 16vw), 245px);
  height: 100%;
  object-fit: cover;
}

.post-body {
  padding: 36px 32px 40px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex-grow: 1;
}

.post-body h3 {
  font-size: 18px;
  margin: 0 0 8px 0;
  max-width: 245px;
}

.post-body p {
  color: var(--vp-c-text-2);
  font-size: 15px;
  line-height: 1.6;
  margin: 0 0 12px 0;
}

.post-link {
  color: var(--vp-c-indigo-1);
  font-size: 14px;
}

@media (max-width: 1099px) {
  .post-body {
    padding: 34px 28px 37px;
  }
  .post-body h3 {
    font-size: 17px;
  }
  .post-link {
    font-size: 13px;
  }
}
@media (max-width: 999px) {
  .post-body {
    padding: 32px 26px 35px;
  }
  .post-body h3 {
    font-size: 16px;
  }
  .post-link {
    font-size: 13px;
  }
}
@media (max-width: 899px) {
  .post-image img {
    width: calc(30px + 15vw);
  }
  .post-body {
    padding: 20px 24px 24px;
  }
  .post-body h3 {
    font-size: 15px;
  }
  .post-link {
    font-size: 13px;
  }
}
@media (max-width: 799px) {
  .post-image img {
    width: calc(30px + 14vw);
  }
  .post-body h3 {
    font-size: 14.5px;
  }
  .post-link {
    font-size: 12.5px;
  }
}

@media (max-width: 768px) {
  .post-image img {
    width: 33vw;
  }
  .post-body h3 {
    font-size: 15px;
    max-width: 275px;
  }
  .post-link {
    font-size: 13px;
  }
}
</style>

<template>
  <div class="post">
    <a :href="post.path" class="no-visual">
      <div class="post-image">
        <Image
          :src="post.image"
          :width="400"
          :height="300"
          :fallback="fallback"
          layout="constrained"
          background="auto"
        />
      </div>
      <div class="post-body">
        <h3>{{ post.title }}</h3>
        <span class="post-link">Read post &rarr;</span>
      </div>
    </a>
  </div>
</template>
