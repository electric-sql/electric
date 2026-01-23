<script setup>
import Section from '../Section.vue'
import Card from '../Card.vue'

const cloudUrl = 'https://dashboard.electric-sql.cloud/'

const secondaryOptions = [
  {
    slug: 'open-source',
    icon: '/img/icons/github.svg',
    title: 'Open Source',
    body: `Self-host Electric with Docker or run it directly on your infrastructure.`,
    href: '/docs/guides/deployment',
  },
  {
    slug: 'local-dev',
    icon: '/img/icons/coding.svg',
    title: 'Local Development',
    body: `Run Electric locally with a single command for development and testing.`,
    href: '/docs/quickstart',
  },
]
</script>

<template>
  <Section>
    <template #title>Deploy on your&nbsp;terms</template>
    <template #tagline>
      Get started with Electric Cloud or run it yourself.
    </template>
    <div class="deployment-grid">
      <div class="cloud-card">
        <a class="no-visual" :href="cloudUrl">
          <div class="card primary">
            <div class="cloud-content">
              <div class="cloud-icon">
                <img src="/img/icons/electric.svg" alt="Electric" />
              </div>
              <div class="cloud-text">
                <h3>Electric Cloud</h3>
                <p>
                  The fastest way to get started. Managed hosting with automatic
                  scaling, monitoring, and zero-ops deployment.
                </p>
              </div>
              <div class="cloud-actions">
                <span class="cta-button primary-cta">Sign up free</span>
                <a :href="'/cloud'" class="secondary-link" @click.stop>
                  Learn more &rarr;
                </a>
              </div>
            </div>
          </div>
        </a>
      </div>
      <div class="secondary-grid">
        <div
          v-for="option in secondaryOptions"
          :key="option.slug"
          class="secondary-card"
        >
          <Card
            :href="option.href"
            :icon="option.icon"
            :title="option.title"
            :body="option.body"
          />
        </div>
      </div>
    </div>
  </Section>
</template>

<style scoped>
.deployment-grid {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin: 32px 0px 40px;
}

.cloud-card {
  width: 100%;
}

.cloud-card .card.primary {
  position: relative;
  display: block;
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  border: 1px solid rgba(42, 44, 52, 0.5);
  overflow: hidden;
  padding: 40px;
}

.cloud-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 20px;
}

.cloud-icon img {
  width: 64px;
  height: 64px;
}

.cloud-text h3 {
  margin: 0 0 12px 0;
  font-size: 1.5rem;
}

.cloud-text p {
  margin: 0;
  max-width: 500px;
  color: var(--vp-c-text-2);
  font-weight: 500;
  font-size: 15px;
  line-height: 1.6;
}

.cloud-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 20px;
  margin-top: 8px;
}

.cta-button.primary-cta {
  display: inline-block;
  padding: 12px 32px;
  background-color: var(--vp-c-brand-1);
  color: white;
  border-radius: 8px;
  font-weight: 600;
  font-size: 15px;
  transition: background-color 0.2s;
}

.cloud-card:hover .cta-button.primary-cta {
  background-color: var(--vp-c-brand-2);
}

.secondary-link {
  color: var(--vp-c-text-2);
  font-size: 14px;
  font-weight: 500;
  transition: color 0.2s;
}

.secondary-link:hover {
  color: var(--vp-c-brand-1);
}

.secondary-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
}

@media (max-width: 768px) {
  .cloud-card .card.primary {
    padding: 32px 24px;
  }

  .cloud-icon img {
    width: 48px;
    height: 48px;
  }

  .cloud-text h3 {
    font-size: 1.25rem;
  }

  .secondary-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 518px) {
  .deployment-grid {
    margin: 32px 24px 40px;
  }

  .cloud-card .card.primary {
    padding: 24px 20px;
  }
}
</style>
