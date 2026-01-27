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
    text: 'Learn more',
    theme: 'brand',
  },
  {
    href: '/cloud',
    text: 'Cloud'
  }
]
</script>

<template>
  <Section :actions="actions">
    <template #title>
      The key to collaborative&nbsp;AI
    </template>
    <template #tagline>
      As the world moves to getting things done through agents, the&nbsp;winners
      are the&nbsp;products that combine AI with
      <span class="no-wrap">team-based collaboration</span>.
    </template>
    <div class="paradigm-comparison">
      <div class="paradigm-panel">
        <h3>❌&nbsp; Single-user <span class="no-wrap">&lt;&gt; single-agent</span></h3>
        <div>
          <p>
            AI apps and agentic systems built on a single-user &lt;&gt; single-agent,
            request &lt;&gt; response paradigm don't cut it.
          </p>
          <p>
            Requests are fragile and hard to resume. The UI blocks while they stream back. Local state isn't shared.
          </p>
          <p>
            It's hard to support either the real-time or async collaboration that are
            key to product-led-growth and enterprise adoption.
          </p>
        </div>
        <figure>
          <img :src="RequestResponse" class="hidden-sm" />
          <img :src="RequestResponseSmall" class="block-sm" />
        </figure>
      </div>
      <div class="paradigm-panel">
        <h3>✅&nbsp; Multi-user <span class="no-wrap">&lt;&gt; multi-agent</span></h3>
        <p>
          With sync, state is persistent, addressable and shared. You get multi-tab, multi-device, multi-user and multi-agent built in.
        </p>
        <p>
          You unlock product-led growth and can weave your product into your customers' workflows and governance stuctures.
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
  gap: 24px;
  align-items: stretch;
  margin-top: 40px;
  margin-bottom: 40px;
}

@media (max-width: 768px) {
  .paradigm-comparison {
    grid-template-columns: 1fr;
    gap: 20px;
  }
}

.paradigm-panel {
  background-color: var(--vp-c-bg-soft);
  border: 1px solid rgba(42, 44, 52, 0.5);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  padding: var(--padding-height) var(--padding-width);

  --padding-width: 40px;
  --padding-height: 40px;
}

@media (min-width: 1020px) and (max-width: 1099px) {
  .paradigm-panel {
    --padding-width: 32px;
    --padding-height: 32px;
  }
}
@media (min-width: 960px) and (max-width: 1019px) {
  .paradigm-panel {
    --padding-width: 30px;
    --padding-height: 32px;
  }
}
@media (min-width: 960px) and (max-width: 989px) {
  .paradigm-panel {
    --padding-width: 29px;
    --padding-height: 30px;
  }
}
@media (min-width: 760px) and (max-width: 959px) {
  .paradigm-panel {
    --padding-width: 28px;
    --padding-height: 28px;
  }
}
@media (max-width: 518px) {
  .paradigm-panel {
    --padding-height: 28px;
    --padding-width: 28px;
  }
}

.paradigm-panel h3 {
  margin: 0 0 1rem 0;
  font-size: 22px;
  font-weight: 600;
  line-height: 28px;
  letter-spacing: -0.02em;
  color: var(--vp-c-text-1);
}

.paradigm-panel p {
  margin: 0;
  font-size: 15px !important;
  line-height: 1.7;
  color: var(--vp-c-text-3) !important;
  font-weight: 500;
  flex: 1;
}

.paradigm-panel figure {
  margin: 20px 0 0 0;
  border-radius: 8px;
  overflow: hidden;
}

.paradigm-panel figure img {
  width: 100%;
  display: block;
}
</style>
