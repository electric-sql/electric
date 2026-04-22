<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vitepress'

const NAV = [
  {
    id: 'agents',
    label: 'Agents',
    base: '/agents',
    docsBase: '/docs/agents',
    homeLabel: 'Electric Agents',
    homeSublabel: 'Wire the agent loop into your online systems',
  },
  {
    id: 'streams',
    label: 'Streams',
    base: '/streams',
    docsBase: '/docs/streams',
    homeLabel: 'Electric Streams',
    homeSublabel: 'The data primitive for the agent loop',
    extras: [
      { label: 'TanStack AI', link: '/docs/streams/integrations/tanstack-ai' },
      { label: 'Vercel AI SDK', link: '/docs/streams/integrations/vercel-ai-sdk' },
      { label: 'Yjs', link: '/docs/streams/integrations/yjs' },
      { label: 'StreamDB', link: '/docs/streams/stream-db' },
      { label: 'DurableStreams.com', link: 'https://durablestreams.com' },
    ],
  },
  {
    id: 'sync',
    label: 'Sync',
    base: '/sync',
    docsBase: '/docs/sync',
    homeLabel: 'Electric Sync',
    homeSublabel: 'The magic behind fast apps',
    extras: [
      { label: 'TanStack DB', link: '/sync/tanstack-db' },
      { label: 'PGlite', link: '/sync/pglite' },
    ],
  },
  '|',
  {
    id: 'cloud',
    label: 'Cloud',
    base: '/cloud',
    homeLabel: 'Electric Cloud',
    homeSublabel: 'Managed infrastructure for Electric',
    primaryLinks: [
      { label: 'Usage', link: '/cloud/usage' },
      { label: 'CLI', link: '/cloud/cli' },
    ],
  },
  { id: 'pricing', label: 'Pricing', link: '/pricing' },
  '|',
  { id: 'blog', label: 'Blog', link: '/blog' },
  { id: 'resources', label: 'More' },
]

const RESOURCES = {
  links: [
    { label: 'Team', link: '/about/team' },
    { label: 'Contact', link: '/about/contact' },
    { label: 'Community', link: '/about/community' },
    { label: 'LLMs / AGENTS.md', link: '/llms' },
  ],
  social: [
    {
      icon: 'discord',
      label: 'Discord',
      link: 'https://discord.electric-sql.com',
    },
    {
      icon: 'github',
      label: 'GitHub',
      link: 'https://github.com/electric-sql/electric',
    },
    { icon: 'x', label: 'X', link: 'https://x.com/ElectricSQL' },
  ],
}

const route = useRoute()
const openId = ref(null)

function toggle(id) {
  openId.value = openId.value === id ? null : id
}

function productSubLinks(item) {
  if (item.primaryLinks?.length) {
    return item.primaryLinks
  }
  const links = [
    { label: 'Quickstart', link: `${item.docsBase}/quickstart` },
    { label: 'Demos', link: `${item.base}/demos` },
    { label: 'Docs', link: item.docsBase },
  ]
  if (item.extras) {
    for (const extra of item.extras) {
      links.push({ label: extra.label, link: extra.link })
    }
  }
  return links
}

watch(
  () => route.path,
  () => {
    openId.value = null
  }
)
</script>

<template>
  <div class="MegaNavMobile">
    <template v-for="(item, index) in NAV" :key="index">
      <hr v-if="item === '|'" class="mega-nav-mobile-divider" />
      <a
        v-else-if="item.link"
        class="mega-nav-mobile-row mega-nav-mobile-leaf"
        :href="item.link"
      >
        <span class="mega-nav-mobile-row-label">{{ item.label }}</span>
      </a>
      <div v-else class="mega-nav-mobile-group" :class="{ open: openId === item.id }">
        <button
          type="button"
          class="mega-nav-mobile-row mega-nav-mobile-branch"
          aria-haspopup="menu"
          :aria-expanded="openId === item.id"
          @click="toggle(item.id)"
        >
          <span class="mega-nav-mobile-row-label">{{ item.label }}</span>
          <span
            class="mega-nav-mobile-row-chevron vpi-chevron-down"
            aria-hidden="true"
          ></span>
        </button>
        <div v-show="openId === item.id" class="mega-nav-mobile-submenu">
          <template v-if="item.id === 'resources'">
            <a
              v-for="link in RESOURCES.links"
              :key="link.link"
              class="mega-nav-mobile-subrow"
              :href="link.link"
              >{{ link.label }}</a
            >
            <div class="mega-nav-mobile-social-row">
              <a
                v-for="s in RESOURCES.social"
                :key="s.link"
                class="mega-nav-mobile-social-link"
                :href="s.link"
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="s.label"
                :title="s.label"
              >
                <span
                  class="mega-nav-social-icon"
                  :class="`vpi-social-${s.icon}`"
                  aria-hidden="true"
                ></span>
              </a>
            </div>
          </template>
          <template v-else>
            <a
              class="mega-nav-mobile-subrow mega-nav-mobile-subrow-brand"
              :href="item.base"
            >
              <span class="mega-nav-mobile-brand-label">{{
                item.homeLabel
              }}</span>
              <span class="mega-nav-mobile-brand-sublabel">{{
                item.homeSublabel
              }}</span>
            </a>
            <a
              v-for="link in productSubLinks(item)"
              :key="link.link + link.label"
              class="mega-nav-mobile-subrow"
              :href="link.link"
              >{{ link.label }}</a
            >
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
