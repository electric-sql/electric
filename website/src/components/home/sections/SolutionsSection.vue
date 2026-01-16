<script setup>
import Section from '../Section.vue'
import Card from '../Card.vue'

const actions = [
  {
    href: '/sync',
    text: 'Learn more',
    theme: 'brand',
  },
  {
    href: '/products',
    text: 'View products',
  },
]

const solutions = [
  {
    slug: 'app',
    title: 'Fast, modern apps',
    body: `Build apps like Linear and Figma with instant, optimistic UI.`,
    href: '/sync#fast-modern-apps',
  },
  {
    slug: 'agent',
    title: 'Resilient AI apps',
    body: `AI apps that work reliably, even with patchy connectivity.`,
    href: '/sync#resilient-ai-apps',
  },
  {
    slug: 'agent',
    title: 'Collaborative AI apps',
    body: `Multi-user, multi-agent apps with real-time collaboration.`,
    href: '/sync#collaborative-ai-apps',
  },
  {
    slug: 'dashboard',
    title: 'Real-time dashboards',
    body: `Live analytics and monitoring dashboards that update instantly.`,
    href: '/sync#real-time-dashboards',
  },
  {
    slug: 'worker',
    title: 'Durable workflows',
    body: `Multi-step agentic workflows that resume after failures.`,
    href: '/sync#durable-workflows',
  },
]
</script>

<template>
  <Section :actions="actions">
    <template #title> What you can build </template>
    <template #tagline>
      Sync enables a new generation of fast, collaborative, and resilient
      applications. Here are the outcomes you can achieve.
    </template>
    <div class="solutions-grid">
      <div
        v-for="(solution, index) in solutions"
        :key="solution.title"
        :class="['solution-card', { 'bottom-row': index >= 3 }]"
      >
        <Card
          :href="solution.href"
          :icon="`/img/home/sync-targets/${solution.slug}.svg`"
          :title="solution.title"
          :body="solution.body"
        />
      </div>
    </div>
  </Section>
</template>

<style scoped>
.solutions-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 32px;
  margin: 32px 0px 40px;
}

/* Bottom row: 2 cards centered */
.solutions-grid .solution-card.bottom-row {
  grid-column: span 1;
}

/* Center the bottom 2 cards */
.solutions-grid .solution-card:nth-child(4) {
  grid-column: 1 / 2;
  margin-left: auto;
  width: 100%;
  max-width: calc(100% + 50%);
  transform: translateX(25%);
}

.solutions-grid .solution-card:nth-child(5) {
  grid-column: 3 / 4;
  margin-right: auto;
  width: 100%;
  max-width: calc(100% + 50%);
  transform: translateX(-25%);
}

@media (max-width: 959px) {
  .solutions-grid {
    gap: 30px;
    grid-template-columns: repeat(2, 1fr);
  }

  .solutions-grid .solution-card:nth-child(4),
  .solutions-grid .solution-card:nth-child(5) {
    grid-column: span 1;
    margin: 0;
    max-width: none;
    transform: none;
  }

  /* Center the 5th card on tablet */
  .solutions-grid .solution-card:nth-child(5) {
    grid-column: 1 / -1;
    max-width: 340px;
    margin: 0 auto;
  }
}

@media (max-width: 518px) {
  .solutions-grid {
    margin: 32px 24px 40px;
    gap: 24px;
    grid-template-columns: 1fr;
  }

  .solutions-grid .solution-card {
    position: relative;
    display: block;
    width: 100%;
    max-width: 340px;
    margin: 0 auto;
  }

  .solutions-grid .solution-card:nth-child(4),
  .solutions-grid .solution-card:nth-child(5) {
    max-width: 340px;
    transform: none;
  }
}
</style>
