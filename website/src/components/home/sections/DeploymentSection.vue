<script setup>
import Section from '../Section.vue'
import Card from '../Card.vue'

const cloudUrl = 'https://dashboard.electric-sql.cloud/'

const secondaryOptions = [
  {
    slug: 'open-source',
    icon: '/img/icons/github.light.svg',
    title: 'Open source',
    body: `Apache 2.0 license, <span class="no-wrap">thriving community</span>`,
    href: '/about/community',
  },
  {
    slug: 'local-dev',
    icon: '/img/icons/coding.svg',
    title: 'Local development',
    body: `Skills, guides and starter templates`,
    href: '/docs/quickstart',
  },
]
</script>

<template>
  <Section>
    <template #title>Managed cloud, open&nbsp;source</template>
    <template #tagline>
      Vendor agnostic,
      <span class="no-wrap">infra agnostic</span>
    </template>
    <div class="deployment-grid">
      <div class="cloud-card">
        <a class="no-visual" :href="cloudUrl">
          <div class="card primary">
            <div class="cloud-content">
              <div class="cloud-icon">
                <img src="/img/icons/ddn.svg" alt="Electric" />
              </div>
              <div class="cloud-text">
                <h3>Electric Cloud</h3>
                <p>
                  <span class="hidden-sm">Scalable, turnkey</span>
                  <span class="inline-sm">Scalable</span>
                  hosting with
                  <span class="no-wrap">usage-based pricing</span>
                </p>
              </div>
              <div class="cloud-actions">
                <VPButton
                    href="/cloud"
                    text="Learn more"
                    theme="brand"
                />
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
  background:
    linear-gradient(to right, var(--vp-c-bg-soft) 45%, transparent 85%),
    linear-gradient(rgba(26, 27, 30, 0.5), rgba(26, 27, 30, 0.5)),
    url('/img/home/dashboard-stream.jpg') right top / auto 109% no-repeat,
    var(--vp-c-bg-soft);
  border: 1px solid rgba(42, 44, 52, 0.5);
  overflow: hidden;
  padding: 32px;
}

.cloud-content {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  gap: 20px;
}

.cloud-icon img {
  width: 64px;
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

@media (min-width: 1280px) {
  .cloud-card .card.primary {
    padding: 52px 32px;
  }
}

@media (min-width: 1024px) and (max-width: 1279px) {
  .cloud-card .card.primary {
    padding: 48px 32px;
  }
}

@media (min-width: 769px) and (max-width: 1023px) {
  .cloud-card .card.primary {
    padding: 42px 32px;
  }
}

@media (max-width: 768px) {
  .cloud-card .card.primary {
    padding: 32px;
    background:
      linear-gradient(to right, var(--vp-c-bg-soft) 40%, transparent 85%),
      linear-gradient(rgba(26, 27, 30, 0.6), rgba(26, 27, 30, 0.6)),
      url('/img/home/dashboard-stream.jpg') right top / auto 109% no-repeat,
      var(--vp-c-bg-soft);
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
    padding: 24px;
    background: var(--vp-c-bg-soft);
  }
}
</style>
