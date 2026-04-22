<script setup>
/* ContactCards — 2×2 grid for the /about/contact page. Three email
   routes (general, sales, press) plus a Community card linking to
   Discord. Each card: mono eyebrow, bold heading, short description,
   and a mono-font link at the bottom (email address or URL). The
   whole card is the clickable link. */

const cards = [
  {
    eyebrow: 'Email · General',
    title: 'General inquiries',
    body: "Say hi, ask a question, or tell us what you're building.",
    link: 'info@electric-sql.com',
    href: 'mailto:info@electric-sql.com',
    external: false,
  },
  {
    eyebrow: 'Email · Sales',
    title: 'Sales team',
    body: 'Pricing, enterprise plans, and procurement.',
    link: 'sales@electric-sql.com',
    href: 'mailto:sales@electric-sql.com',
    external: false,
  },
  {
    eyebrow: 'Email · Press',
    title: 'Media inquiries',
    body: 'Press requests, interviews, and asset requests.',
    link: 'press@electric-sql.com',
    href: 'mailto:press@electric-sql.com',
    external: false,
  },
  {
    eyebrow: 'Community · Discord',
    title: 'Chat with the community',
    body: 'Join the team and thousands of developers building with Electric.',
    link: 'discord.electric-sql.com',
    href: 'https://discord.electric-sql.com',
    external: true,
  },
]
</script>

<template>
  <div class="cc-grid">
    <a
      v-for="c in cards"
      :key="c.href"
      :href="c.href"
      :target="c.external ? '_blank' : undefined"
      :rel="c.external ? 'noopener' : undefined"
      class="cc-card"
    >
      <div class="cc-eyebrow mono">
        <span class="cc-dot" />
        {{ c.eyebrow }}
      </div>
      <h3 class="cc-title">{{ c.title }}</h3>
      <p class="cc-body">{{ c.body }}</p>
      <span class="cc-link mono">{{ c.link }}</span>
    </a>
  </div>
</template>

<style scoped>
.cc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin: 32px 0 40px;
}

.cc-card {
  display: flex;
  flex-direction: column;
  padding: 22px 24px 20px;
  border: 1px solid var(--ea-divider);
  border-radius: 12px;
  background: var(--ea-surface);
  text-decoration: none !important;
  color: inherit;
  transition:
    border-color 0.2s ease,
    transform 0.2s ease;
}

.cc-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}

.cc-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ea-text-3);
  margin-bottom: 14px;
  font-family: var(--vp-font-family-mono);
}

.cc-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}

.cc-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--ea-text-1);
  margin: 0 0 6px;
  line-height: 1.3;
  letter-spacing: -0.005em;
}

.cc-body {
  font-size: 14px;
  line-height: 1.55;
  color: var(--ea-text-2);
  margin: 0 0 20px;
  flex: 1;
}

.cc-link {
  font-size: 12.5px;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-brand-1);
  font-weight: 500;
  letter-spacing: 0.01em;
}

@media (max-width: 549px) {
  .cc-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}
</style>
