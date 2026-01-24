<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import RepoCard from '../RepoCard.vue'
import Section from '../Section.vue'

const actions = [
  {
    href: 'https://discord.electric-sql.com',
    text: 'Join Discord',
    theme: 'brand',
  },
  {
    href: 'https://github.com/electric-sql/electric',
    text: 'GitHub',
  },
]

const repos = [
  'durable-streams/durable-streams',
  'electric-sql/electric',
  'electric-sql/pglite',
  'TanStack/db',
]

// Lazy-load the Discord widget to avoid scroll jank
const discordContainer = ref(null)
const showWidget = ref(false)
let observer = null

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        showWidget.value = true
        observer.disconnect()
      }
    },
    { rootMargin: '200px' } // Start loading slightly before visible
  )
  if (discordContainer.value) {
    observer.observe(discordContainer.value)
  }
})

onUnmounted(() => {
  observer?.disconnect()
})
</script>

<style scoped>
.community-widgets {
  padding: 12px 0 24px;
  display: flex;
  flex-direction: row;
  gap: 40px;
}
.discord,
.github {
  flex: 1 1 0px;
}
.github {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

@media (max-width: 767px) {
  .community-widgets {
    flex-direction: column;
  }
  .discord {
    order: 2;
  }
}

.discord-placeholder {
  width: 100%;
  height: 523px;
  border: 1px solid rgba(48, 54, 61, 0.5);
  border-radius: 8px;
  background: #2b2d31;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
}
</style>

<template>
  <Section :actions="actions">
    <template #title> Fully open source </template>
    <template #tagline>
      With a thriving
      <a href="https://discord.electric-sql.com"> open source community</a>
      and
      <span class="no-wrap-xs">
        millions of
        <span class="no-wrap"> downloads a week</span></span
      >.
    </template>
    <div class="community-widgets">
      <div ref="discordContainer" class="discord">
        <iframe
          v-if="showWidget"
          src="https://discord.com/widget?id=933657521581858818&theme=dark"
          width="350"
          height="523"
          sandbox="allow-popups allow-same-origin allow-popups-to-escape-sandbox allow-scripts"
          style="width: 100%; border: 1px solid rgba(48, 54, 61, 0.5); border-radius: 8px; overflow: hidden"
        >
        </iframe>
        <div v-else class="discord-placeholder">Loading Discord...</div>
      </div>
      <div class="github">
        <a
          v-for="repo in repos"
          :key="repo"
          :href="`https://github.com/${repo}`"
          class="no-visual"
        >
          <RepoCard :repo="repo" />
        </a>
      </div>
    </div>
  </Section>
</template>
