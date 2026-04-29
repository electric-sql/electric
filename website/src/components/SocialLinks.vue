<script setup>
/* SocialLinks — horizontal row of social profile chips for the
   Community and Contact pages. Each chip: platform icon + handle,
   styled as a rounded pill that matches the site card aesthetic.
   Icons render via CSS mask using the Iconify simple-icons set so
   they inherit the current text color (no separate dark/light
   variants needed). */

const links = [
  {
    icon: 'bluesky',
    label: '@electric.ax',
    href: 'https://bsky.app/profile/electric.ax',
  },
  {
    icon: 'bluesky',
    label: '@pglite.dev',
    href: 'https://bsky.app/profile/pglite.dev',
  },
  {
    icon: 'x',
    label: '@ElectricSQL',
    href: 'https://x.com/ElectricSQL',
  },
  {
    icon: 'linkedin',
    label: 'company/ElectricSQL',
    href: 'https://www.linkedin.com/company/electric-sql',
  },
]
</script>

<template>
  <div class="sl-row">
    <a
      v-for="link in links"
      :key="link.href"
      :href="link.href"
      target="_blank"
      rel="noopener"
      class="sl-chip"
    >
      <span
        class="sl-icon"
        :class="`sl-icon-${link.icon}`"
        aria-hidden="true"
      />
      <span class="sl-label">{{ link.label }}</span>
    </a>
  </div>
</template>

<style scoped>
.sl-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 16px 0 32px;
}

.sl-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px 8px 12px;
  border: 1px solid var(--ea-divider);
  border-radius: 999px;
  background: var(--ea-surface);
  color: var(--ea-text-2);
  text-decoration: none !important;
  transition:
    border-color 0.2s ease,
    color 0.2s ease,
    transform 0.2s ease;
}

.sl-chip:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--ea-text-1);
  transform: translateY(-1px);
}

.sl-icon {
  display: inline-block;
  width: 14px;
  height: 14px;
  background-color: currentColor;
  flex-shrink: 0;
  -webkit-mask: var(--sl-icon-url) no-repeat center / contain;
  mask: var(--sl-icon-url) no-repeat center / contain;
}

.sl-icon-bluesky {
  --sl-icon-url: url('https://api.iconify.design/simple-icons/bluesky.svg');
}

.sl-icon-x {
  --sl-icon-url: url('https://api.iconify.design/simple-icons/x.svg');
}

.sl-icon-linkedin {
  --sl-icon-url: url('https://api.iconify.design/simple-icons/linkedin.svg');
}

.sl-label {
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

@media (max-width: 549px) {
  .sl-row {
    gap: 8px;
  }
  .sl-chip {
    padding: 7px 12px;
  }
}
</style>
