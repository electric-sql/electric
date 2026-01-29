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

export async function getStarCount(repoPath, currentCount) {
  const ttl = 3_600 // 1 hour

  return localStorageCache(`starCount.${repoPath}`, ttl, async () => {
    return await fetchStarCount(repoPath, currentCount)
  })
}

export async function fetchStarCount(repoPath, currentCount) {
  const url = `https://api.github.com/repos/${repoPath}`
  const response = await fetch(url)

  if (response.ok) {
    const data = await response.json()

    return data.stargazers_count
  }

  return currentCount
}

export async function fetchStarCounts() {
  const counts = {}

  const results = await Promise.allSettled([
    fetchStarCount(
      `durable-streams/durable-streams`,
      FALLBACK_DURABLE_STREAMS_COUNT
    ),
    fetchStarCount(`electric-sql/electric`, FALLBACK_ELECTRIC_COUNT),
    fetchStarCount(`electric-sql/pglite`, FALLBACK_PGLITE_COUNT),
    fetchStarCount(`tanstack/db`, FALLBACK_TANSTACK_DB_COUNT),
  ])

  counts[`durable-streams/durable-streams`] = results[0].value
  counts[`electric-sql/electric`] = results[1].value
  counts[`electric-sql/pglite`] = results[2].value
  counts[`tanstack/db`] = results[3].value

  return counts
}
