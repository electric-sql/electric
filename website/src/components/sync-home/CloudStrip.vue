<script setup>
const secondaryCards = [
  {
    slug: 'open-source',
    icon: '/img/icons/github.light.svg',
    title: 'Open source',
    body: 'Apache 2.0 license · ★ 9.5k',
    href: 'https://github.com/electric-sql/electric',
  },
  {
    slug: 'local-dev',
    icon: '/img/icons/coding.svg',
    title: 'Local development',
    body: 'Quickstart, guides and starter templates',
    href: '/docs/quickstart',
  },
]
</script>

<template>
  <div class="cloud-strip">
    <div class="cloud-primary">
      <div class="cloud-primary-icon">
        <img src="/img/icons/ddn.svg" alt="Electric Cloud" />
      </div>
      <div class="cloud-primary-text">
        <h3 class="cloud-primary-title">Electric Cloud</h3>
        <p class="cloud-primary-body">
          Scalable, turnkey hosting with usage-based pricing
        </p>
      </div>
      <div class="cloud-primary-actions">
        <VPButton
          href="https://dashboard.electric-sql.cloud/"
          text="Sign up"
          theme="brand"
        />
        <VPButton href="/cloud" text="Learn more" theme="alt" />
      </div>
    </div>
    <div class="cloud-secondary">
      <a
        v-for="card in secondaryCards"
        :key="card.slug"
        :href="card.href"
        class="cloud-card no-visual"
      >
        <div class="cloud-card-icon">
          <img :src="card.icon" :alt="card.title" />
        </div>
        <div class="cloud-card-text">
          <div class="cloud-card-title">{{ card.title }}</div>
          <div class="cloud-card-body">{{ card.body }}</div>
        </div>
      </a>
    </div>
  </div>
</template>

<style scoped>
.cloud-strip {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 24px;
}

.cloud-primary {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 20px;
  padding: 32px;
  border-radius: 8px;
  border: 1px solid var(--ea-divider);
  background: var(--ea-surface);
  transition: border-color 0.2s;
}

.cloud-primary-icon img {
  width: 40px;
  height: 40px;
  display: block;
}

.cloud-primary-text {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cloud-primary-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--ea-text-1);
  line-height: 1.3;
}

.cloud-primary-body {
  margin: 0;
  font-size: 15px;
  color: var(--ea-text-2);
  line-height: 1.5;
  font-weight: 500;
}

.cloud-primary-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
  flex-wrap: wrap;
}

.cloud-secondary {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cloud-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16px;
  padding: 20px;
  border-radius: 8px;
  border: 1px solid var(--ea-divider);
  background: var(--ea-surface);
  text-decoration: none;
  flex: 1;
  transition: border-color 0.2s;
}

.cloud-card:hover {
  border-color: var(--vp-c-brand-1);
}

.cloud-card-icon img {
  width: 28px;
  height: 28px;
  display: block;
  object-fit: contain;
}

.cloud-card-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.cloud-card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ea-text-1);
  line-height: 1.3;
}

.cloud-card-body {
  font-size: 13px;
  color: var(--ea-text-3);
  line-height: 1.4;
}

@media (max-width: 768px) {
  .cloud-strip {
    grid-template-columns: 1fr;
    gap: 20px;
  }
}
</style>
