<script setup>
import { data } from '../../../data/posts.data.ts'
import Section from '../home/Section.vue'

const post = data.find((p) => p.path.includes('super-fast-apps-on-sync'))

const actions = [
  {
    href: post?.path || '/blog',
    text: 'Read more',
    theme: 'brand',
  },
  {
    href: '/products',
    text: 'View products',
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
        Sync is the magic behind fast, modern, AI-native apps.
        <span class="no-wrap">Build with sync primitives for instant</span>
        reactivity, resilience, and real-time collaboration.
      </template>
      <div class="solutions-grid">
        <div class="solution-panel" id="reactivity">
          <div class="panel-icon">
            <img src="/img/home/sync-targets/app.svg" alt="Reactivity" />
          </div>
          <div class="panel-content">
            <h3 class="panel-title">Reactivity</h3>
            <p class="panel-subtitle">Fast, modern apps</p>
            <p class="panel-body">
              Build apps like Linear and Figma with instant, optimistic UI.
              Sync data into a local store for sub-millisecond reads and
              updates that feel instantaneous.
            </p>
            <p class="panel-products">
              <strong>Use:</strong>
              <a href="/products/postgres-sync">Postgres Sync</a> +
              <a href="/products/tanstack-db">TanStack DB</a>
            </p>
          </div>
        </div>

        <div class="solution-panel" id="resilience">
          <div class="panel-icon">
            <img src="/img/home/sync-targets/agent.svg" alt="Resilience" />
          </div>
          <div class="panel-content">
            <h3 class="panel-title">Resilience</h3>
            <p class="panel-subtitle">Resilient AI apps</p>
            <p class="panel-body">
              AI apps that work reliably, even with patchy connectivity.
              Durable streams ensure AI responses are never lost and can
              resume from any point.
            </p>
            <p class="panel-products">
              <strong>Use:</strong>
              <a href="/products/durable-streams">Durable Streams</a>
            </p>
          </div>
        </div>

        <div class="solution-panel" id="collaboration">
          <div class="panel-icon">
            <img src="/img/home/sync-targets/agent.svg" alt="Collaboration" />
          </div>
          <div class="panel-content">
            <h3 class="panel-title">Collaboration</h3>
            <p class="panel-subtitle">Collaborative AI apps</p>
            <p class="panel-body">
              Multi-user, multi-agent apps with real-time collaboration.
              Sync shared state between users and AI agents with automatic
              conflict resolution.
            </p>
            <p class="panel-products">
              <strong>Use:</strong>
              <a href="/products/durable-streams">Durable Streams</a> +
              <a href="/products/tanstack-db">TanStack DB</a>
            </p>
          </div>
        </div>

        <div class="solution-panel" id="durability">
          <div class="panel-icon">
            <img src="/img/home/sync-targets/worker.svg" alt="Durability" />
          </div>
          <div class="panel-content">
            <h3 class="panel-title">Durability</h3>
            <p class="panel-subtitle">Durable workflows</p>
            <p class="panel-body">
              Multi-step agentic workflows that resume after failures.
              Build reliable, long-running processes with durable state
              and event streams.
            </p>
            <p class="panel-products">
              <strong>Use:</strong>
              <a href="/products/durable-streams">Durable Streams</a>
            </p>
          </div>
        </div>
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
  margin-top: 32px;
}

.solution-panel {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 20px;
  padding: 24px;
  background-color: var(--vp-c-bg-soft);
  border: 1px solid rgba(42, 44, 52, 0.5);
  border-radius: 12px;
  height: 100%;
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

.panel-products {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.5;
}

.panel-products strong {
  color: var(--vp-c-text-2);
  font-weight: 500;
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
