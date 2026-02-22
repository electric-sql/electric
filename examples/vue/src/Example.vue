<script setup lang="ts">
import { useShape } from "@electric-sql/vue"
import { useTimeAgo } from "@vueuse/core"
import { computed, ref } from "vue"

type Maintainer = {
  id: string
  github: string
  name: string
  role: string
  location: string | null
  avatar_url: string
  contributions: number
}

type Repo = {
  id: string
  name: string
  description: string
  language: string
  stars: number
}

type PullRequest = {
  id: string
  repo_id: string
  author_id: string
  number: number
  title: string
  merged_at: string
  url: string
}

const baseUrl = import.meta.env.VITE_ELECTRIC_URL ?? `http://localhost:3000`
const shapeParams = {
  source_id: import.meta.env.VITE_ELECTRIC_SOURCE_ID,
  secret: import.meta.env.VITE_ELECTRIC_SOURCE_SECRET,
}

const maintainers = useShape<Maintainer>({
  url: `${baseUrl}/v1/shape`,
  params: { table: "maintainers", ...shapeParams },
})

const repos = useShape<Repo>({
  url: `${baseUrl}/v1/shape`,
  params: { table: "repos", ...shapeParams },
})

const prs = useShape<PullRequest>({
  url: `${baseUrl}/v1/shape`,
  params: { table: "pull_requests", ...shapeParams },
})

const isLoading = computed(() => maintainers.isLoading || repos.isLoading || prs.isLoading)

const lastSynced = computed(() => {
  const times = [maintainers.lastSyncedAt, repos.lastSyncedAt, prs.lastSyncedAt].filter(Boolean) as number[]
  if (times.length === 0) return null
  return new Date(Math.max(...times))
})

const maintainersWithPrs = computed(() => {
  if (isLoading.value) return []

  return maintainers.data
    .filter((m) => prs.data.some((pr) => pr.author_id === m.id))
    .sort((a, b) => b.contributions - a.contributions)
    .map((m) => {
      const authorPrs = prs.data
        .filter((pr) => pr.author_id === m.id)
        .sort((a, b) => new Date(b.merged_at).getTime() - new Date(a.merged_at).getTime())

      return {
        ...m,
        prs: authorPrs,
        lastActive: authorPrs[0]?.merged_at ?? null,
      }
    })
})

function repoName(repoId: string) {
  return repos.data.find((r) => r.id === repoId)?.name ?? repoId
}

const githubUsername = ref("")
const isAdding = ref(false)
const addError = ref("")

async function addMaintainer() {
  const username = githubUsername.value.trim()
  if (!username) return

  isAdding.value = true
  addError.value = ""

  try {
    const ghRes = await fetch(`https://api.github.com/users/${username}`)
    if (!ghRes.ok) throw new Error(`GitHub user "${username}" not found`)
    const gh = await ghRes.json()

    const res = await fetch("/api/maintainers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: username,
        github: username,
        name: gh.name || username,
        role: "Contributor",
        location: gh.location || null,
        avatar_url: gh.avatar_url,
        contributions: gh.public_repos ?? 0,
      }),
    })

    if (!res.ok) {
      const body = await res.json()
      throw new Error(body.error || "Insert failed")
    }

    githubUsername.value = ""
  } catch (e) {
    addError.value = (e as Error).message
  } finally {
    isAdding.value = false
  }
}
</script>

<template>
  <div>
    <form class="add-form" @submit.prevent="addMaintainer">
      <input
        v-model="githubUsername"
        type="text"
        placeholder="GitHub username"
        :disabled="isAdding"
      />
      <button type="submit" :disabled="isAdding || !githubUsername.trim()">
        {{ isAdding ? "Adding..." : "Add" }}
      </button>
      <span v-if="addError" class="add-error">{{ addError }}</span>
    </form>

    <div v-if="isLoading" class="loading">Syncing...</div>

    <template v-else>
      <div class="stats">
        {{ maintainers.data.length }} maintainers · {{ prs.data.length }} PRs · {{ repos.data.length }} repos
        <span v-if="lastSynced"> · synced {{ useTimeAgo(ref(lastSynced)).value }}</span>
      </div>

      <div class="maintainers">
        <div v-for="m in maintainersWithPrs" :key="m.id" class="maintainer-card">
          <div class="maintainer-header">
            <img :src="m.avatar_url" :alt="m.name" class="avatar" />
            <div class="maintainer-info">
              <div class="maintainer-name">
                {{ m.name }}
                <span v-if="m.lastActive" class="last-active">{{ useTimeAgo(ref(new Date(m.lastActive))).value }}</span>
              </div>
              <div class="maintainer-meta">
                @{{ m.github }} · {{ m.role }}
                <template v-if="m.location"> · {{ m.location }}</template>
              </div>
            </div>
            <div class="contribution-count">{{ m.contributions }}</div>
          </div>

          <div v-for="pr in m.prs" :key="pr.id" class="pr">
            <a :href="pr.url" target="_blank" rel="noopener" class="pr-link">
              <span class="pr-repo">{{ repoName(pr.repo_id) }}</span>
              <span class="pr-number">#{{ pr.number }}</span>
              <span class="pr-title">{{ pr.title }}</span>
            </a>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.add-form {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  justify-content: center;
}

.add-form input {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid #3a3a3e;
  background: #1a1a1e;
  color: #eee;
  font-size: 13px;
  outline: none;
}

.add-form input:focus {
  border-color: #5b7a9d;
}

.add-form button {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid #3a3a3e;
  background: #2a2a2e;
  color: #ccc;
  font-size: 13px;
  cursor: pointer;
}

.add-form button:hover:not(:disabled) {
  background: #3a3a3e;
}

.add-form button:disabled {
  opacity: 0.5;
  cursor: default;
}

.add-error {
  color: #e55;
  font-size: 12px;
}

.loading {
  color: #666;
  text-align: center;
  padding: 40px;
}

.stats {
  font-size: 13px;
  color: #555;
  margin-bottom: 24px;
  text-align: center;
}

.maintainers {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.maintainer-card {
  border-bottom: 1px solid #2a2a2e;
  padding: 20px 24px;
}

.maintainer-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}

.maintainer-info {
  flex: 1;
}

.maintainer-name {
  font-weight: 600;
  color: #eee;
  font-size: 15px;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.last-active {
  font-weight: 400;
  font-size: 11px;
  color: #555;
}

.maintainer-meta {
  font-size: 12px;
  color: #666;
}

.contribution-count {
  font-size: 13px;
  color: #555;
  font-variant-numeric: tabular-nums;
}

.contribution-count::after {
  content: " commits";
  font-size: 11px;
  color: #444;
}

.pr {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 12px;
  margin: 0 -12px;
  border-radius: 6px;
  transition: background-color 0.15s ease;
}

.pr:hover {
  background: rgba(255, 255, 255, 0.03);
}

.pr-link {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 6px;
  text-decoration: none;
  min-width: 0;
}

.pr-repo {
  font-size: 12px;
  color: #555;
  flex-shrink: 0;
}

.pr-number {
  font-size: 12px;
  color: #5b7a9d;
  flex-shrink: 0;
}

.pr-title {
  font-size: 13px;
  color: #aaa;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pr-link:hover .pr-title {
  color: #ddd;
}
</style>
