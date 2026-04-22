<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vitepress'
import MegaNavPanel from './MegaNavPanel.vue'

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
    secondary: {
      heading: 'Integrations',
      items: [
        {
          label: 'TanStack AI',
          sublabel: 'Resumable chat sessions',
          link: '/docs/streams/integrations/tanstack-ai',
          icon: '/img/icons/tanstack.svg',
        },
        {
          label: 'Vercel AI SDK',
          sublabel: 'Resumable AI SDK transport',
          link: '/docs/streams/integrations/vercel-ai-sdk',
          icon: '/img/icons/vercel.svg',
        },
        {
          label: 'Yjs',
          sublabel: 'Sync CRDTs over HTTP',
          link: '/docs/streams/integrations/yjs',
          icon: '/img/icons/yjs.svg',
        },
        {
          label: 'StreamDB',
          sublabel: 'Reactive DB in a stream',
          link: '/docs/streams/stream-db',
          icon: '/img/icons/durable-streams.square.svg',
        },
      ],
    },
    extras: [
      {
        label: 'DurableStreams.com',
        sublabel: 'The open stream protocol',
        link: 'https://durablestreams.com',
        external: true,
      },
    ],
  },
  {
    id: 'sync',
    label: 'Sync',
    base: '/sync',
    docsBase: '/docs/sync',
    homeLabel: 'Electric Sync',
    homeSublabel: 'The magic behind fast apps',
    secondary: {
      heading: 'Client primitives',
      items: [
        {
          label: 'TanStack DB',
          sublabel: 'Reactive client store',
          link: '/sync/tanstack-db',
          icon: '/img/icons/tanstack.svg',
        },
        {
          label: 'PGlite',
          sublabel: 'Embeddable Postgres',
          link: '/sync/pglite',
          icon: '/img/icons/pglite.svg',
        },
      ],
    },
  },
  '|',
  {
    id: 'cloud',
    label: 'Cloud',
    base: '/cloud',
    homeLabel: 'Electric Cloud',
    homeSublabel: 'Managed infrastructure for Electric',
    primaryLinks: [
      {
        label: 'Pricing',
        sublabel: 'Plans and usage-based pricing',
        link: '/pricing',
        className: 'mega-nav-fallback-pricing',
      },
      {
        label: 'Usage',
        sublabel: 'Connect a database and make API requests',
        link: '/cloud/usage',
      },
      {
        label: 'CLI',
        sublabel: 'Manage Cloud resources from the terminal',
        link: '/cloud/cli',
      },
    ],
  },
  { id: 'pricing', label: 'Pricing', link: '/pricing', className: 'mega-nav-top-pricing' },
  '|',
  { id: 'blog', label: 'Blog', link: '/blog', className: 'mega-nav-top-blog' },
  { id: 'resources', label: 'More' },
]

const RESOURCES = {
  columns: [
    [
      {
        label: 'Team',
        sublabel: 'Meet the team behind Electric',
        link: '/about/team',
      },
      {
        label: 'Contact',
        sublabel: 'Get in touch',
        link: '/about/contact',
      },
    ],
    [
      {
        label: 'Blog',
        sublabel: 'Latest posts and updates',
        link: '/blog',
        className: 'mega-nav-fallback-blog',
      },
      {
        label: 'Community',
        sublabel: 'Discord, GitHub and more',
        link: '/about/community',
      },
      {
        label: 'LLMs / AGENTS.md',
        sublabel: 'Coding agent instructions',
        link: '/llms',
      },
    ],
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
    {
      icon: 'x',
      label: 'X',
      link: 'https://x.com/ElectricSQL',
    },
  ],
}

const route = useRoute()

const activeId = computed(() => {
  const p = route.path || '/'
  if (p === '/') return null
  if (p.startsWith('/agents') || p.startsWith('/docs/agents')) return 'agents'
  if (p.startsWith('/streams') || p.startsWith('/docs/streams')) return 'streams'
  if (p.startsWith('/sync') || p.startsWith('/docs/sync')) return 'sync'
  if (p.startsWith('/cloud')) return 'cloud'
  if (p.startsWith('/pricing')) return 'pricing'
  if (p.startsWith('/blog')) return 'blog'
  if (p.startsWith('/about') || p === '/llms') return 'resources'
  return null
})

const openId = ref(null)
let closeTimer = null
// Tracks how the currently-open panel was opened. Click should only toggle
// closed if the panel was opened by an explicit click/keypress; otherwise a
// pointer hover on a hover-capable device would open the panel and the click
// that follows would immediately close it again.
let openedBy = null

function clearCloseTimer() {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
}

function openPanel(id, source = 'hover') {
  clearCloseTimer()
  if (openId.value !== id) openedBy = source
  openId.value = id
}

function scheduleClose() {
  clearCloseTimer()
  closeTimer = setTimeout(() => {
    openId.value = null
    openedBy = null
  }, 250)
}

function closeNow() {
  clearCloseTimer()
  openId.value = null
  openedBy = null
}

function activateTrigger(id) {
  if (openId.value === id) {
    if (openedBy === 'click') {
      closeNow()
    } else {
      openedBy = 'click'
    }
  } else {
    openPanel(id, 'click')
  }
}

// Single root-level pointer tracker. Far more robust than per-trigger
// mouseenter/mouseleave handlers, which flicker around edges and during
// the panel mount/unmount transitions.
function onPointerOver(event) {
  const trigger = event.target.closest?.('.mega-nav-trigger-wrap')
  if (trigger && trigger.dataset.id) {
    openPanel(trigger.dataset.id)
    return
  }
  const panel = event.target.closest?.('.mega-nav-panel-wrap')
  if (panel) {
    clearCloseTimer()
    return
  }
  // Hovering nav chrome between items (dividers / non-trigger links).
  scheduleClose()
}

function onRootLeave() {
  scheduleClose()
}

watch(
  () => route.path,
  () => closeNow()
)

function onDocClick(event) {
  if (!openId.value) return
  const root = document.querySelector('.MegaNav')
  if (root && !root.contains(event.target)) closeNow()
}

function onKey(event) {
  if (event.key === 'Escape') closeNow()
}

onMounted(() => {
  document.addEventListener('click', onDocClick, true)
  document.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick, true)
  document.removeEventListener('keydown', onKey)
  clearCloseTimer()
})
</script>

<template>
  <div
    class="VPNavBarMenu MegaNav"
    @mouseover="onPointerOver"
    @mouseleave="onRootLeave"
  >
    <template v-for="(item, index) in NAV" :key="index">
      <span
        v-if="item === '|'"
        class="mega-nav-divider"
        aria-hidden="true"
      ></span>
      <a
        v-else-if="item.link"
        class="VPNavBarMenuLink mega-nav-link"
        :class="[item.className, { active: activeId === item.id }]"
        :href="item.link"
      >
        {{ item.label }}
      </a>
      <div
        v-else
        class="mega-nav-trigger-wrap"
        :data-id="item.id"
      >
        <button
          type="button"
          class="VPNavBarMenuLink mega-nav-link mega-nav-trigger"
          :class="{
            active: activeId === item.id,
            open: openId === item.id,
          }"
          aria-haspopup="menu"
          :aria-expanded="openId === item.id"
          :aria-controls="`mega-panel-${item.id}`"
          @click.stop="activateTrigger(item.id)"
          @keydown.enter.prevent="activateTrigger(item.id)"
          @keydown.space.prevent="activateTrigger(item.id)"
        >
          {{ item.label }}
          <span
            class="mega-nav-chevron vpi-chevron-down"
            aria-hidden="true"
          ></span>
        </button>
        <transition name="mega-nav-fade">
          <div
            v-if="openId === item.id"
            :id="`mega-panel-${item.id}`"
            class="mega-nav-panel-wrap"
          >
            <MegaNavPanel
              v-if="item.id === 'resources'"
              :resources="RESOURCES"
              @navigate="closeNow"
            />
            <MegaNavPanel
              v-else
              :product="item"
              @navigate="closeNow"
            />
          </div>
        </transition>
      </div>
    </template>
  </div>
</template>
