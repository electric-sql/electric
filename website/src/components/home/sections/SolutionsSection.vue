<script setup>
import { data } from '../../../../data/posts.data.ts'
import LandscapeBlogPostListing from '../../LandscapeBlogPostListing.vue'
import Section from '../Section.vue'

const posts =
  data
    .filter(post => post.homepageSolution)
    .sort((a, b) => parseInt(a.homepageOrder) - parseInt(b.homepageOrder))

const actions = [
  {
    href: '/sync',
    text: 'Why sync',
    theme: 'brand',
  },
  {
    href: '/sync#solutions',
    text: 'Solutions',
  },
]

const solutions = [
  {
    slug: 'app',
    title: 'Reactivity',
    subtitle: 'Fast, modern apps',
    body: `Build apps like Linear and Figma with instant, optimistic UI.`,
    href: '/sync#reactivity',
    cta: 'Learn more',
  },
  {
    slug: 'agent',
    title: 'Resilience',
    subtitle: 'Resilient AI apps',
    body: `AI apps that work reliably, even with patchy connectivity.`,
    href: '/sync#resilience',
    cta: 'Learn more',
  },
  {
    slug: 'agent',
    title: 'Collaboration',
    subtitle: 'Collaborative AI apps',
    body: `Multi-user, multi-agent apps with real-time collaboration.`,
    href: '/sync#collaboration',
    cta: 'Learn more',
  },
  {
    slug: 'worker',
    title: 'Durability',
    subtitle: 'Durable workflows',
    body: `Multi-step agentic workflows that resume after failures.`,
    href: '/sync#durability',
    cta: 'Learn more',
  },
]
</script>

<template>
  <Section :actions="actions">
    <template #title>Unlock&nbsp;collaboration, unlock&nbsp;adoption</template>
    <template #tagline>
      Sync is the magic behind
      <a href="/blog/2025/07/29/local-first-sync-with-tanstack-db">
        fast, modern software</a>
      and the&nbsp;key to building
      <span class="no-wrap">
        <a href="/blog/2026/01/12/durable-sessions-for-collaborative-ai">
          collaborative&nbsp;AI&nbsp;apps</a><span class="hidden-sm"> and </span></span><span class="hidden-sm"> agentic&nbsp;systems</span>.
    </template>
    <div class="solutions-grid">
      <LandscapeBlogPostListing v-for="post in posts"
          :key="post.slug"
          :post="post"
      />
      <!--
      <a
        v-for="solution in solutions"
        :key="solution.title"
        :href="solution.href"
        class="solution-panel no-visual"
      >
        <div class="panel-icon">
          <img :src="`/img/home/sync-targets/${solution.slug}.svg`" :alt="solution.title" />
        </div>
        <div class="panel-content">
          <h3 class="panel-title">{{ solution.title }}</h3>
          <p class="panel-body">{{ solution.body }}</p>
          <p class="panel-subtitle">{{ solution.subtitle }}</p>
          <span class="panel-cta">{{ solution.cta }} &rarr;</span>
        </div>
      </a>
      -->
    </div>
  </Section>
</template>

<style scoped>
.solutions-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
  margin: 40px 0px;
  align-items: stretch;
}

.solution-panel {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 20px;
  padding: 24px;
  /*background-color: var(--vp-c-bg-soft);
  border: 1px solid rgba(42, 44, 52, 0.5);*/
  border-radius: 12px;
  text-decoration: none;
  transition: border-color 0.2s ease, background-color 0.2s ease;
  height: 100%;
}

.solution-panel:hover {
  border-color: var(--vp-c-brand-1);
  background-color: var(--vp-c-bg-soft-up);
}

.panel-icon {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
}

.panel-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.panel-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.panel-title {
  margin: 0 0 4px 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.panel-subtitle {
  margin: 0 0 8px 0;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--vp-c-brand-1);
}

.panel-body {
  margin: 0 0 12px 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--vp-c-text-2);
  flex: 1;
}

.panel-cta {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  margin-top: auto;
}

.solution-panel:hover .panel-cta {
  text-decoration: underline;
}

@media (max-width: 768px) {
  .solutions-grid {
    grid-template-columns: 1fr;
    gap: 20px;
  }

  .solution-panel {
    padding: 20px;
  }

  .panel-icon {
    width: 40px;
    height: 40px;
  }
}
</style>
