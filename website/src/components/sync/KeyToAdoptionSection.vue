<script setup>
import { data } from '../../../data/posts.data.ts'
import Section from '../home/Section.vue'

import RequestResponse from '/static/img/blog/durable-sessions-for-collaborative-ai/request-response.jpg?url'
import RequestResponseSmall from '/static/img/blog/durable-sessions-for-collaborative-ai/request-response.sm.jpg?url'

import SyncBased from '/static/img/blog/durable-sessions-for-collaborative-ai/sync-based-architecture.jpg?url'
import SyncBasedSmall from '/static/img/blog/durable-sessions-for-collaborative-ai/sync-based-architecture.sm.jpg?url'

const post = data.find((p) => p.path.includes('durable-sessions-for-collaborative-ai'))

const actions = [
  {
    href: post?.path || '/blog',
    text: 'Read more',
    theme: 'brand',
  },
]
</script>

<template>
  <Section :actions="actions">
    <template #title>
      Unlock collaboration, unlock&nbsp;adoption
    </template>
    <template #tagline>
      As the world moves to getting things done through agents,
      <span class="no-wrap">the winners are going to be the products</span>
      that combine AI with
      <span class="no-wrap">team-based collaboration</span>
    </template>
    <div class="paradigm-comparison">
      <div class="paradigm-panel">
        <h3>Traditional: request <span class="no-wrap">&lt;&gt; response</span></h3>
        <p>
          Today's AI SDKs assume single-user &lt;&gt; single-agent. The UI
          blocks while requests stream back. Local state isn't shared.
          <span class="hidden-sm">
            It doesn't support the kind of team-based collaboration that
            enterprise software depends on.
          </span>
        </p>
        <figure>
          <img :src="RequestResponse" class="hidden-sm" />
          <img :src="RequestResponseSmall" class="block-sm" />
        </figure>
      </div>
      <div class="paradigm-panel">
        <h3>Sync-based: multi-user <span class="no-wrap">&lt;&gt; multi-agent</span></h3>
        <p>
          With sync, state is persistent, addressable and shared. Multiple users and
          agents collaborate on durable sessions.
          <span class="hidden-sm">
            This allows you to weave AI into the fabric of team-based, enterprise software.
          </span>
        </p>
        <figure>
          <img :src="SyncBased" class="hidden-sm" />
          <img :src="SyncBasedSmall" class="block-sm" />
        </figure>
      </div>
    </div>
  </Section>
</template>

<style scoped>
.paradigm-comparison {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  margin-top: 32px;
}

@media (max-width: 849px) {
  .paradigm-comparison {
    grid-template-columns: 1fr;
    gap: 40px;
    max-width: 560px;
    margin-left: auto;
    margin-right: auto;
  }
}

.paradigm-panel {
  background-color: var(--vp-c-bg-soft);
  border: 1px solid rgba(42, 44, 52, 0.5);
  border-radius: 12px;
  padding: 28px;
  display: flex;
  flex-direction: column;
}

.paradigm-panel h3 {
  margin: 0 0 12px 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.paradigm-panel p {
  margin: 0 0 20px 0;
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  font-weight: 500;
  flex: 1;
}

.paradigm-panel figure {
  margin: 0;
  border-radius: 8px;
  overflow: hidden;
}

.paradigm-panel figure img {
  width: 100%;
  display: block;
}

@media (max-width: 559px) {
  .paradigm-panel {
    padding: 22px;
  }

  .paradigm-panel h3 {
    font-size: 1rem;
  }

  .paradigm-panel p {
    font-size: 0.9rem;
  }
}
</style>
