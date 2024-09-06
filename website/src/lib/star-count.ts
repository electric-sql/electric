const FALLBACK_ELECTRIC_COUNT = 6_000
const FALLBACK_PGLITE_COUNT = 7_500

export async function localStorageCache(key: string, ttl: number, valueCb: () => unknown) {
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

export async function getStarCount(repoName, currentCount) {
  const ttl = 3_600 // 1 hour

  return localStorageCache(`starCount.${repoName}`, ttl, async () => {
    return await fetchStarCount(repoName, currentCount)
  })
}

export async function fetchStarCount(repoName, currentCount) {
  const url = `https://api.github.com/repos/electric-sql/${repoName}`
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
    fetchStarCount('electric', FALLBACK_ELECTRIC_COUNT),
    fetchStarCount('pglite', FALLBACK_PGLITE_COUNT)
  ])

  counts['electric'] = results[0].value
  counts['pglite'] = results[1].value

  return counts
}
