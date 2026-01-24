<script setup>
import { ref, onMounted } from 'vue'

const props = defineProps({
  repo: {
    type: String,
    required: true,
  },
})

const CACHE_TIMEOUT = 60000

const data = ref(null)
const loading = ref(true)
const error = ref(null)

async function fetchRepo() {
  const url = `https://api.github.com/repos/${props.repo}`
  const now = Date.now()

  try {
    // Check cache first
    const cached = localStorage.getItem(url)
    if (cached) {
      const parsed = JSON.parse(cached)
      if (Math.abs(now - parsed.time) < CACHE_TIMEOUT) {
        data.value = parsed.data
        loading.value = false
        return
      }
    }

    const resp = await fetch(url)
    if (!resp.ok) {
      throw new Error(`Failed to fetch repo: ${resp.status}`)
    }
    const json = await resp.json()

    localStorage.setItem(url, JSON.stringify({ time: now, data: json }))
    data.value = json
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function formatStars(count) {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`
  }
  return count.toString()
}

onMounted(() => {
  fetchRepo()
})
</script>

<template>
  <div class="repo-card">
    <div v-if="loading" class="loading">Loading...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <template v-else-if="data">
      <div class="header">
        <svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            fill-rule="evenodd"
            d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8zM5 12.25v3.25a.25.25 0 00.4.2l1.45-1.087a.25.25 0 01.3 0L8.6 15.7a.25.25 0 00.4-.2v-3.25a.25.25 0 00-.25-.25h-3.5a.25.25 0 00-.25.25z"
          />
        </svg>
        <span class="name">
          <a :href="data.html_url">{{ data.full_name }}</a>
        </span>
      </div>
      <div v-if="data.fork" class="fork-info">
        Forked from <a :href="data.source?.html_url">{{ data.source?.full_name }}</a>
      </div>
      <div class="description">{{ data.description }}</div>
      <div class="meta">
        <div v-if="data.language" class="language">
          <img
            class="language-icon"
            :src="`/img/integrations/${data.language.toLowerCase()}.svg`"
            :alt="data.language"
          />
          <span>{{ data.language }}</span>
        </div>
        <div v-if="data.stargazers_count > 0" class="stars">
          <svg class="icon" aria-label="stars" viewBox="0 0 16 16" width="16" height="16">
            <path
              fill-rule="evenodd"
              d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25zm0 2.445L6.615 5.5a.75.75 0 01-.564.41l-3.097.45 2.24 2.184a.75.75 0 01.216.664l-.528 3.084 2.769-1.456a.75.75 0 01.698 0l2.77 1.456-.53-3.084a.75.75 0 01.216-.664l2.24-2.183-3.096-.45a.75.75 0 01-.564-.41L8 2.694v.001z"
            />
          </svg>
          <span>{{ formatStars(data.stargazers_count) }}</span>
        </div>
        <div v-if="data.forks > 0" class="forks">
          <svg class="icon" aria-label="fork" viewBox="0 0 16 16" width="16" height="16">
            <path
              fill-rule="evenodd"
              d="M5 3.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm0 2.122a2.25 2.25 0 10-1.5 0v.878A2.25 2.25 0 005.75 8.5h1.5v2.128a2.251 2.251 0 101.5 0V8.5h1.5a2.25 2.25 0 002.25-2.25v-.878a2.25 2.25 0 10-1.5 0v.878a.75.75 0 01-.75.75h-4.5A.75.75 0 015 6.25v-.878zm3.75 7.378a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm3-8.75a.75.75 0 100-1.5.75.75 0 000 1.5z"
            />
          </svg>
          <span>{{ data.forks }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.repo-card {
  border: 1px solid rgba(48, 54, 61, 0.5);
  border-radius: 6px;
  background: hsl(225 6.25% 12.549% / 1);
  padding: 16px;
  line-height: 1.5;
}

.loading,
.error {
  color: rgb(139, 148, 158);
  font-size: 14px;
}

.error {
  color: #f85149;
}

.header {
  display: flex;
  align-items: center;
}

.header .icon {
  fill: rgb(139, 148, 158);
  margin-right: 8px;
}

.name {
  font-weight: 600;
}

.name a {
  text-decoration: none;
  color: #d0bcff;
}

.name a:hover {
  text-decoration: underline;
}

.fork-info {
  color: rgb(139, 148, 158);
  font-size: 14px;
}

.fork-info a {
  color: inherit;
  text-decoration: none;
}

.description {
  font-size: 14px;
  margin: 8px 0;
  color: rgb(139, 148, 158);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta {
  font-size: 14px;
  color: rgb(139, 148, 158);
  display: flex;
  gap: 16px;
}

.meta .icon {
  fill: rgb(139, 148, 158);
}

.language,
.stars,
.forks {
  display: flex;
  align-items: center;
  gap: 4px;
}

.language-icon {
  width: 14px;
  height: 14px;
}
</style>
