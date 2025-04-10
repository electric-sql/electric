<script setup>
  import Card from './home/Card.vue'

  const { slug, stack } = defineProps(['slug', 'stack'])
</script>

<style scoped>
  .row {
    display: flex;
    gap: 24px;
  }
  .avatar {
    flex: 0 0 128px;
  }
  .avatar img {
    width: 100%;
    height: auto;
    border-radius: 8px;
  }
  .content {
    flex: 1;
  }
  @media (max-width: 559px) {
    .row {
      flex-direction: column;
    }
    .avatar {
      flex: 0 0 auto;
      overflow: hidden;
      border-radius: 8px;
      width: 128px;
      height: 152px;
    }
    .avatar img {
      position: relative;
      display: block;
      width: 128px;
    }
    :deep(.row > .content > h3) {
      margin-top: 0px;
    }
  }
  :deep(.row > .content > p) {
    max-width: none;
  }
  ul.stack {
    list-style: none;
    margin: 14px 0;
    padding: 0;
    display: flex;
  }
  ul.stack li {
    display: flex;
    align-items: center;
    height: 30px;
    margin: 0px !important;
  }
  ul.stack img {
    width: 21px;
    margin: 3.5px 5px 3.5px 0;
    height: 21px;
  }
  ul.stack span.name {
    margin-right: 1rem;
    height: 30px;
    line-height: 30px;
    color: var(--vp-c-text-3);
    font-size: 14px;
    font-weight: 400;
  }
  @media (max-width: 518px) {
    .avatar img {
      margin-top: 12px;
      width: 128px;
    }
  }
  @media (max-width: 419px) {
    ul.stack li:first-child {
      display: none;
    }
  }
</style>

<template>
  <Card>
    <a :href="`/docs/walkthroughs/${slug}`" class="no-visual row">
      <div class="avatar">
        <img class="avatar" :src="`/img/tutorials/${slug}.jpg`" />
      </div>
      <div class="content">
        <slot></slot>
        <ul class="stack">
          <li v-for="item in stack" :key="item">
            <img :src="`/img/integrations/${item.toLowerCase()}.svg`" />
            <span class="name">{{ item }}</span>
          </li>
        </ul>
      </div>
    </a>
  </Card>
</template>