/* eslint-disable no-empty-pattern */
import { describe, expect, assert, inject } from 'vitest'
import { exec } from 'child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { testWithIssuesTable } from './support/test-context'
import { CHUNK_LAST_OFFSET_HEADER, SHAPE_HANDLE_HEADER } from '../src/constants'
import { ShapeStream } from '../src'
import { isUpToDateMessage } from '../src/helpers'

// FIXME: pull from environment?
const maxAge = 1 // seconds
const staleAge = 3 // seconds

// see https://blog.nginx.org/blog/nginx-caching-guide for details
enum CacheStatus {
  MISS = `MISS`, // item was not in the cache
  BYPASS = `BYPASS`, // not used by us
  EXPIRED = `EXPIRED`, // there was a cache entry but was expired, so we got a fresh response
  STALE = `STALE`, // cache entry > max age but < stale-while-revalidate so we got a stale response
  UPDATING = `UPDATING`, // same as STALE but indicates proxy is updating stale entry
  REVALIDATED = `REVALIDATED`, // you this request revalidated at the server
  HIT = `HIT`, // cache hit
}

/**
 * Retrieve the {@link CacheStatus} from the provided response
 */
function getCacheStatus(res: Response): CacheStatus {
  return res.headers.get(`X-Proxy-Cache`) as CacheStatus
}

/**
 * Clear the proxy cache files to simulate an empty cache
 */
export async function clearProxyCache({
  proxyCacheContainerName,
  proxyCachePath,
}: {
  proxyCacheContainerName: string
  proxyCachePath: string
}): Promise<void> {
  return new Promise((res) =>
    exec(
      `docker exec ${proxyCacheContainerName} sh -c 'rm -rf ${proxyCachePath}'`,
      (_) => res()
    )
  )
}

const it = testWithIssuesTable.extend<{
  proxyCacheBaseUrl: string
  clearCache: () => Promise<void>
}>({
  proxyCacheBaseUrl: async ({ clearCache }, use) => {
    await clearCache()
    use(inject(`proxyCacheBaseUrl`))
  },
  clearCache: async ({}, use) => {
    use(
      async () =>
        await clearProxyCache({
          proxyCacheContainerName: inject(`proxyCacheContainerName`),
          proxyCachePath: inject(`proxyCachePath`),
        })
    )
  },
})

describe(`HTTP Proxy Cache`, () => {
  it(`should get a short max-age cache-conrol header in live mode`, async ({
    insertIssues,
    proxyCacheBaseUrl,
    issuesTableUrl,
  }) => {
    // First request get initial request
    const initialRes = await fetch(
      `${proxyCacheBaseUrl}/v1/shape?table=${issuesTableUrl}&offset=-1`,
      {}
    )

    expect(initialRes.status).toBe(200)
    expect(getCacheStatus(initialRes)).toBe(CacheStatus.MISS)

    // add some data and follow with live request
    await insertIssues({ title: `foo` })
    const searchParams = new URLSearchParams({
      table: issuesTableUrl,
      handle: initialRes.headers.get(`electric-handle`)!,
      offset: initialRes.headers.get(`electric-offset`)!,
      live: `true`,
    })

    const liveRes = await fetch(
      `${proxyCacheBaseUrl}/v1/shape?${searchParams.toString()}`,
      {}
    )
    expect(liveRes.status).toBe(200)
    expect(getCacheStatus(liveRes)).toBe(CacheStatus.MISS)

    // Second request gets a cached response
    const cachedRes = await fetch(
      `${proxyCacheBaseUrl}/v1/shape?${searchParams.toString()}`,
      {}
    )
    expect(cachedRes.status).toBe(200)

    expect(getCacheStatus(cachedRes)).toBe(CacheStatus.HIT)
  })

  it(`should collapse requests in live mode`, async ({
    insertIssues,
    proxyCacheBaseUrl,
    issuesTableUrl,
    aborter,
  }) => {
    const numClients = 10
    const eventTarget = new EventTarget()

    let reqStats = {
      reqs: 0,
      cacheHits: 0,
    }

    const resetReqStats = () => {
      reqStats = {
        reqs: 0,
        cacheHits: 0,
      }
    }

    const fetchClient = async (...args: Parameters<typeof fetch>) => {
      const resp = await fetch(...args)
      reqStats.reqs++
      if (getCacheStatus(resp) === CacheStatus.HIT) {
        reqStats.cacheHits++
      }

      return resp
    }

    const waitForClients = () =>
      new Promise<void>((res) => {
        let ctr = 0
        const listener = () => {
          if (++ctr === numClients) {
            eventTarget.removeEventListener(`up-to-date`, listener)
            res()
          }
        }
        eventTarget.addEventListener(`up-to-date`, listener)
      })

    for (let i = 0; i < numClients; i++) {
      const stream = new ShapeStream({
        url: `${proxyCacheBaseUrl}/v1/shape`,
        signal: aborter.signal,
        fetchClient,
        params: {
          table: issuesTableUrl,
          foo: `cache-test`,
        },
      })

      stream.subscribe((messages) => {
        if (isUpToDateMessage(messages[messages.length - 1])) {
          eventTarget.dispatchEvent(new Event(`up-to-date`))
        }
      })
    }

    // wait for clients to catch up
    await waitForClients()

    // add some data, should collapse requests and respond to
    // all of them but one with cache hits
    resetReqStats()
    await insertIssues({ title: `foo` })
    await waitForClients()
    expect(reqStats.reqs).toBe(numClients)
    expect(reqStats.cacheHits).toBe(numClients - 1)
  })

  it(`should get cached response on second request`, async ({
    proxyCacheBaseUrl,
    issuesTableUrl,
  }) => {
    // First request gets non-cached response
    const originalRes = await fetch(
      `${proxyCacheBaseUrl}/v1/shape?table=${issuesTableUrl}&offset=-1`,
      {}
    )

    expect(originalRes.status).toBe(200)
    expect(getCacheStatus(originalRes)).toBe(CacheStatus.MISS)

    // Second request gets cached response
    const cachedRes = await fetch(
      `${proxyCacheBaseUrl}/v1/shape?table=${issuesTableUrl}&offset=-1`,
      {}
    )
    expect(cachedRes.status).toBe(200)

    expect(getCacheStatus(cachedRes)).toBe(CacheStatus.HIT)
  })

  it(`should get stale response when max age is passed but cache is not yet revalidated`, async ({
    proxyCacheBaseUrl,
    issuesTableUrl,
  }) => {
    const originalRes = await fetch(
      `${proxyCacheBaseUrl}/v1/shape?table=${issuesTableUrl}&offset=-1`,
      {}
    )
    const lastOffset = originalRes.headers.get(CHUNK_LAST_OFFSET_HEADER)
    const shapeHandle = originalRes.headers.get(SHAPE_HANDLE_HEADER)
    const urlToTest = `${proxyCacheBaseUrl}/v1/shape?table=${issuesTableUrl}&offset=${lastOffset}&handle=${shapeHandle}`

    // Make a first request such that response is cached
    const originalUpToDateRes = await fetch(urlToTest, {})

    expect(originalUpToDateRes.status).toBe(200)
    expect(getCacheStatus(originalUpToDateRes)).toBe(CacheStatus.MISS)

    // Second request gets cached response
    const cachedRes = await fetch(urlToTest, {})
    expect(cachedRes.status).toBe(200)

    expect(getCacheStatus(cachedRes)).toBe(CacheStatus.HIT)

    // Now wait for the response to be passed its max-age but before the stale-while-revalidate
    await sleep(maxAge * 1000 + ((staleAge - maxAge) / 2) * 1000)

    // Third request gets cached response
    const staleRes = await fetch(urlToTest, {})

    expect(staleRes.status).toBe(200)
    expect(getCacheStatus(staleRes)).toBe(CacheStatus.STALE)
  })

  it(`should get fresh response when age is passed the stale age`, async ({
    proxyCacheBaseUrl,
    issuesTableUrl,
  }) => {
    const originalRes = await fetch(
      `${proxyCacheBaseUrl}/v1/shape?table=${issuesTableUrl}&offset=-1`,
      {}
    )
    const lastOffset = originalRes.headers.get(CHUNK_LAST_OFFSET_HEADER)
    const shapeHandle = originalRes.headers.get(SHAPE_HANDLE_HEADER)
    const urlToTest = `${proxyCacheBaseUrl}/v1/shape?table=${issuesTableUrl}&offset=${lastOffset}&handle=${shapeHandle}`

    // Make a first request such that response is cached
    const originalUpToDateRes = await fetch(urlToTest, {})

    expect(originalUpToDateRes.status).toBe(200)
    expect(getCacheStatus(originalUpToDateRes)).toBe(CacheStatus.MISS)

    // Second request gets cached response
    const cachedRes = await fetch(urlToTest, {})
    expect(cachedRes.status).toBe(200)

    expect(getCacheStatus(cachedRes)).toBe(CacheStatus.HIT)

    // Now wait for the response to be passed its max-age but before the stale-while-revalidate
    await sleep(staleAge * 1000 + 2000)

    // Third request gets cached response
    const staleRes = await fetch(urlToTest, {})

    expect(staleRes.status).toBe(200)
    expect(getCacheStatus(staleRes)).toBe(CacheStatus.REVALIDATED)
  }, 10_000)
})

describe(`HTTP Initial Data Caching`, () => {
  it(`tells client to resync when shape is out of scope`, async ({
    proxyCacheBaseUrl,
    issuesTableUrl,
    clearIssuesShape,
    insertIssues,
  }) => {
    // add some data
    await insertIssues({ title: `foo1` }, { title: `foo2` })

    // Make a client that fetches a shape
    // which forces the shape data to be cached
    const client1Res = await fetch(
      `${proxyCacheBaseUrl}/v1/shape?table=${issuesTableUrl}&offset=-1`,
      {}
    )
    expect(client1Res.status).toBe(200)
    const originalShapeHandle =
      client1Res.headers.get(`electric-handle`) ?? undefined
    assert(originalShapeHandle, `Should have shape handle`)
    expect(getCacheStatus(client1Res)).toBe(CacheStatus.MISS)

    // Make a 2nd client that fetches the shape
    // check that it is served from cached data
    const client2Res = await fetch(
      `${proxyCacheBaseUrl}/v1/shape?table=${issuesTableUrl}&offset=-1`,
      {}
    )
    expect(client2Res.status).toBe(200)
    const shapeHandle2 = client2Res.headers.get(`electric-handle`) ?? undefined

    expect(
      originalShapeHandle,
      `Shape handle changed but expected it to stay the same`
    ).toBe(shapeHandle2)

    expect(getCacheStatus(client2Res)).toBe(CacheStatus.HIT)

    const latestOffset = client2Res.headers.get(`electric-offset`)
    assert(latestOffset, `latestOffset should be defined`)

    // Now GC the shape
    await clearIssuesShape(originalShapeHandle)

    // Now try to go live
    // should tell you to go back to initial sync
    // because the shape is out of scope
    const liveRes = await fetch(
      `${proxyCacheBaseUrl}/v1/shape?table=${issuesTableUrl}&offset=${latestOffset}&handle=${originalShapeHandle}&live`,
      {}
    )
    expect(liveRes.status).toBe(409)
    const newShapeHandle = liveRes.headers.get(SHAPE_HANDLE_HEADER)
    assert(newShapeHandle !== originalShapeHandle)

    const newCacheIgnoredSyncRes = await fetch(
      `${proxyCacheBaseUrl}/v1/shape?table=${issuesTableUrl}&offset=-1&handle=${newShapeHandle}`,
      {}
    )

    expect(newCacheIgnoredSyncRes.status).toBe(200)
    expect(getCacheStatus(newCacheIgnoredSyncRes)).toBe(CacheStatus.MISS)
    const cacheBustedShapeHandle =
      newCacheIgnoredSyncRes.headers.get(SHAPE_HANDLE_HEADER)
    assert(cacheBustedShapeHandle)
    expect(cacheBustedShapeHandle).not.toBe(originalShapeHandle)

    // Then try do that and check that we get new shape handle
    const newInitialSyncRes = await fetch(
      `${proxyCacheBaseUrl}/v1/shape?table=${issuesTableUrl}&offset=-1&handle=${newShapeHandle}`,
      {}
    )
    const cachedShapeHandle =
      newInitialSyncRes.headers.get(SHAPE_HANDLE_HEADER) ?? undefined
    expect(newInitialSyncRes.status).toBe(200)
    expect(getCacheStatus(newInitialSyncRes)).toBe(CacheStatus.HIT)
    expect(
      cachedShapeHandle,
      `Got old shape handle that is out of scope`
    ).not.toBe(originalShapeHandle)
  })
})
