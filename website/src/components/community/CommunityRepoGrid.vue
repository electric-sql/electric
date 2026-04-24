<script setup>
/* CommunityRepoGrid — 2x2 grid of open source project cards for the
   /about/community page. Each card shows live GitHub stars and weekly
   npm downloads in the eyebrow, project name, one-line description,
   and a "View on GitHub" CTA. The card itself is a link.

   Mirrors the fetch/cache pattern used by the homepage
   OpenSourceSection so star and download counts don't hit GitHub /
   npm again when the user has already visited the home page in the
   same hour. */
import { reactive, onMounted } from 'vue'

const repos = reactive({
  'electric-sql/electric': {
    name: 'ElectricSQL',
    desc: 'Postgres sync engine for real-time apps',
    stars: '9k',
    downloads: '',
  },
  'electric-sql/pglite': {
    name: 'PGlite',
    desc: 'Postgres in WASM, in the browser',
    stars: '14k',
    downloads: '',
  },
  'durable-streams/durable-streams': {
    name: 'Durable Streams',
    desc: 'Persistent event streams over HTTP',
    stars: '1k',
    downloads: '',
  },
  'TanStack/db': {
    name: 'TanStack DB',
    desc: 'Reactive client-side data store',
    stars: '3k',
    downloads: '',
  },
})

function formatCount(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

async function fetchCached(key, ttl, fn) {
  try {
    const cached = localStorage.getItem(key)
    if (cached) {
      const { value, expiry } = JSON.parse(cached)
      if (Date.now() < expiry) return value
    }
    const value = await fn()
    localStorage.setItem(key, JSON.stringify({ value, expiry: Date.now() + ttl }))
    return value
  } catch {
    return null
  }
}

onMounted(async () => {
  const ttl = 3_600_000

  const starFetches = Object.keys(repos).map(async (repo) => {
    const count = await fetchCached(`stars.${repo}`, ttl, async () => {
      const res = await fetch(`https://api.github.com/repos/${repo}`)
      if (!res.ok) return null
      const data = await res.json()
      return data.stargazers_count
    })
    if (count) repos[repo].stars = formatCount(count)
  })

  const npmPackages = {
    'electric-sql/electric': '@electric-sql/client',
    'electric-sql/pglite': '@electric-sql/pglite',
    'durable-streams/durable-streams': '@durable-streams/client',
    'TanStack/db': '@tanstack/db',
  }

  const downloadFetches = Object.entries(npmPackages).map(async ([repo, pkg]) => {
    const count = await fetchCached(`npm.${pkg}`, ttl, async () => {
      const res = await fetch(`https://api.npmjs.org/downloads/point/last-week/${pkg}`)
      if (!res.ok) return null
      const data = await res.json()
      return data.downloads
    })
    if (count) repos[repo].downloads = `${formatCount(count)}/wk`
  })

  await Promise.allSettled([...starFetches, ...downloadFetches])
})
</script>

<template>
  <div class="cg-grid">
    <a
      v-for="(repo, key) in repos"
      :key="key"
      :href="`https://github.com/${key}`"
      class="cg-card"
      target="_blank"
      rel="noopener"
    >
      <div class="cg-eyebrow mono">
        <svg
          class="cg-gh-icon"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1-.02-1.96-3.2.69-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.2 1.77 1.2 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.04 0 0 .98-.31 3.2 1.18.93-.26 1.92-.39 2.91-.39s1.98.13 2.91.39c2.22-1.49 3.19-1.18 3.19-1.18.64 1.58.24 2.75.12 3.04.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.21.66.79.55C20.21 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
        </svg>
        <span class="cg-sep">·</span>
        <span class="cg-stat">☆ {{ repo.stars }}</span>
        <template v-if="repo.downloads">
          <span class="cg-sep">·</span>
          <span class="cg-stat">↓ {{ repo.downloads }}</span>
        </template>
      </div>
      <div class="cg-body">
        <h3 class="cg-title">{{ repo.name }}</h3>
        <p class="cg-desc">{{ repo.desc }}</p>
      </div>
      <span class="cg-cta-pill">
        <span class="cg-cta-text mono">{{ key }}</span>
        <svg
          class="cg-cta-arrow"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M5 11L11 5" />
          <path d="M6 5h5v5" />
        </svg>
      </span>
    </a>
  </div>
</template>

<style scoped>
.cg-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin: 32px 0 40px;
}

.cg-card {
  display: flex;
  flex-direction: column;
  padding: 22px 24px 20px;
  border: 1px solid var(--ea-divider);
  border-radius: 10px;
  background: var(--ea-surface);
  text-decoration: none !important;
  color: inherit;
  transition:
    border-color 0.2s ease,
    transform 0.2s ease;
}

.cg-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}

.cg-eyebrow {
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

.cg-gh-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  opacity: 0.85;
}

.cg-sep {
  color: var(--ea-divider);
}

.cg-stat {
  white-space: nowrap;
}

.cg-body {
  flex: 1;
  margin-bottom: 18px;
}

.cg-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--ea-text-1);
  margin: 0 0 6px;
  line-height: 1.3;
  letter-spacing: -0.005em;
}

.cg-desc {
  font-size: 14px;
  line-height: 1.55;
  color: var(--ea-text-2);
  margin: 0;
}

.cg-cta-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  padding: 6px 12px 6px 14px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-black);
  border-radius: 20px;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: 0.01em;
  transition: background-color 0.2s ease;
}

.cg-card:hover .cg-cta-pill {
  background: var(--vp-c-brand-2);
}

.cg-cta-text {
  font-family: var(--vp-font-family-mono);
}

.cg-cta-arrow {
  width: 11px;
  height: 11px;
  flex-shrink: 0;
  opacity: 0.95;
}

@media (max-width: 768px) {
  .cg-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .cg-card {
    padding: 20px 22px 18px;
  }
}
</style>
