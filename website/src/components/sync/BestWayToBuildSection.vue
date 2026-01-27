<script setup>
import { data } from '../../../data/posts.data.ts'
import Section from '../home/Section.vue'

const post = data.find((p) => p.path.includes('super-fast-apps-on-sync'))

const actions = [
  {
    href: post?.path || '/blog',
    text: 'Learn more',
    theme: 'brand',
  },
  {
    href: '/products',
    text: 'Products',
  },
]

const panels = [
  {
    id: 'reactivity',
    title: 'Super-fast reactivity',
    body: 'Build fast, modern apps like Figma and Linear. <span class="no-wrap-md">With sub-millisecond</span> reactivity and <span class="no-wrap-sm">instant local&nbsp;writes</span>.',
    icon: '/img/home/sync-targets/app.svg',
    link: '/blog/posts/2025-07-29-super-fast-apps-on-sync-with-tanstack-db',
  },
  {
    id: 'resilience',
    title: 'Resilient transport',
    body: 'Build apps that work reliably, even with patchy connectivity. With resilient transport that ensures data is never&nbsp;lost.',
    icon: '/img/icons/resilience.svg',
    link: '/blog/posts/2025-04-09-building-ai-apps-on-sync',
  },
  {
    id: 'collaboration',
    title: 'Real-time collaboration',
    body: 'Build multi-user, multi-agent apps that naturally support both real-time and asynchronous collaboration.',
    icon: '/img/home/sync-targets/agent.svg',
    link: '/blog/posts/2026-01-12-durable-sessions-for-collaborative-ai',
  },
  {
    id: 'durability',
    title: 'Durable state',
    body: 'Build multi-step agentic workflows that resume after failures. With agents and workers syncing and resuming from durable&nbsp;state.',
    icon: '/img/icons/durable-streams.square.svg',
    link: '/blog/2025/12/23/durable-streams-0.1.0#introducing-the-state-protocol',
  },
]
</script>

<template>
  <div id="solutions">
    <Section :actions="actions">
      <template #title>
        The best way to <span class="no-wrap">build apps</span>
      </template>
      <template #tagline>
        Sync makes your apps super-fast, with end-to-end reactivity, resilience and
        <span class="no-wrap-sm">
          built-in
          <span class="no-wrap">
            multi-user</span>
          collaboration.
        </span>
      </template>
      <div class="solutions-grid">
        <a
          v-for="panel in panels"
          :key="panel.id"
          :href="panel.link"
          class="solution-panel no-visual"
          :id="panel.id"
        >
          <div class="panel-icon">
            <img :src="panel.icon" :alt="panel.title" />
          </div>
          <div class="panel-content">
            <h3 class="panel-title" v-html="panel.title" />
            <p class="panel-body" v-html="panel.body" />
            <hr />
            <span class="panel-link">Read more &rarr;</span>
          </div>
        </a>
      </div>
    </Section>
  </div>
</template>

<style scoped>
.solutions-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
  align-items: stretch;
  margin-top: 40px;
  margin-bottom: 40px;
}

.solution-panel {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  background-color: var(--vp-c-bg-soft);
  border: 1px solid rgba(42, 44, 52, 0.5);
  border-radius: 12px;
  height: 100%;
  overflow: hidden;

  --padding-width: 40px;
  --padding-height: 40px;
  --extra-padding-width: 8px;
}

@media (min-width: 1020px) and (max-width: 1099px) {
  .solution-panel {
    --padding-width: 32px;
    --padding-height: 32px;
    --extra-padding-width: 6px;
  }
}
@media (min-width: 960px) and (max-width: 1019px) {
  .solution-panel {
    --padding-width: 30px;
    --padding-height: 32px;
    --extra-padding-width: 6px;
  }
}
@media (min-width: 960px) and (max-width: 989px) {
  .solution-panel {
    --padding-width: 29px;
    --padding-height: 30px;
    --extra-padding-width: 5px;
  }
}
@media (min-width: 760px) and (max-width: 959px) {
  .solution-panel {
    --padding-width: 28px;
    --padding-height: 28px;
    --extra-padding-width: 4px;
  }
}
@media (max-width: 518px) {
  .solution-panel {
    --padding-height: 28px;
    --padding-width: 28px;
    --extra-padding-width: 4px;
  }
}

.panel-icon {
  flex-shrink: 0;
  padding: calc(var(--padding-height) + 8px) 0 4px var(--padding-width);
}

.panel-icon img {
  width: calc(40px + 1.5vw);
  height: calc(40px + 1.5vw);
  min-width: 50px;
  min-height: 50px;
  margin: -4px -2px;
  object-fit: contain;
}

.panel-content {
  min-width: 0;
  padding:
    var(--padding-height)
    var(--padding-width)
    calc(var(--padding-height))
    calc(var(--padding-width) - var(--extra-padding-width));
}

.panel-title {
  margin: 0 0 1rem 0;
  font-size: 22px;
  font-weight: 600;
  line-height: 28px;
  letter-spacing: -0.02em;
  color: var(--vp-c-text-1);
}

.panel-body {
  margin: 0;
  font-size: 15px !important;
  line-height: 1.7;
  font-weight: 500;
  color: var(--vp-c-text-3) !important;
  flex: 1;
}

hr {
  margin: 16px 0 16px;
  border: none;
  border-top: 1px solid var(--vp-c-divider);
}

.panel-link {
  color: var(--vp-c-indigo-1);
  font-size: 13px;
  font-weight: 450;
}

@media (max-width: 768px) {
  .solutions-grid {
    grid-template-columns: 1fr;
    gap: 20px;
  }
}
</style>
