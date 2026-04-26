import type { StarCountByRepo } from '../types/data-loaders'

const FALLBACK_DURABLE_STREAMS_COUNT = 1_000
const FALLBACK_ELECTRIC_COUNT = 9_000
const FALLBACK_PGLITE_COUNT = 14_000
const FALLBACK_TANSTACK_DB_COUNT = 3_000

export async function localStorageCache(
  key: string,
  ttl: number,
  valueCb: () => unknown
) {
  const now = new Date().getTime()
  const cachedItem = localStorage.getItem(key)

  if (cachedItem) {
    const cachedData = JSON.parse(cachedItem)

    if (now < cachedData.expiry) {
      return cachedData.value
    }
  }

  const value = await valueCb()
  const expiry = now + ttl * 1000

  const dataToCache = {
    value: value,
    expiry: expiry,
  }
  localStorage.setItem(key, JSON.stringify(dataToCache))

  return value
}

export async function getStarCount(repoPath: string, currentCount: number) {
  const ttl = 3_600 // 1 hour

  return localStorageCache(`starCount.${repoPath}`, ttl, async () => {
    return await fetchStarCount(repoPath, currentCount)
  })
}

export async function fetchStarCount(repoPath: string, currentCount: number) {
  const url = `https://api.github.com/repos/${repoPath}`
  const response = await fetch(url)

  if (response.ok) {
    const data = await response.json()

    return data.stargazers_count
  }

  return currentCount
}

const REPO_KEYS = [
  `durable-streams/durable-streams`,
  `electric-sql/electric`,
  `electric-sql/pglite`,
  `tanstack/db`,
] as const

type RepoKey = (typeof REPO_KEYS)[number]

const REPO_FALLBACKS: Record<RepoKey, number> = {
  'durable-streams/durable-streams': FALLBACK_DURABLE_STREAMS_COUNT,
  'electric-sql/electric': FALLBACK_ELECTRIC_COUNT,
  'electric-sql/pglite': FALLBACK_PGLITE_COUNT,
  'tanstack/db': FALLBACK_TANSTACK_DB_COUNT,
}

export async function fetchStarCounts(): Promise<StarCountByRepo> {
  const results = await Promise.allSettled(
    REPO_KEYS.map((k) => fetchStarCount(k, REPO_FALLBACKS[k]))
  )
  const out: StarCountByRepo = {}
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!
    const key: RepoKey = REPO_KEYS[i]!
    out[key] = r.status === `fulfilled` ? r.value : REPO_FALLBACKS[key]
  }
  return out
}
