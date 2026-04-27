import { describe, expect, it, vi } from 'vitest'
import { fetchEntityTypeNames, fetchEntityUrls } from '../src/completions'

import { fetchShapeRows } from '../src/shape-fetch.js'

vi.mock(`../src/shape-fetch.js`, () => ({
  fetchShapeRows: vi.fn().mockResolvedValue([]),
}))
const mockFetchShapeRows = vi.mocked(fetchShapeRows)

const ENV = {
  electricAgentsUrl: `http://localhost:4437`,
  electricAgentsIdentity: `test`,
}

describe(`fetchEntityTypeNames`, () => {
  it(`returns type names from a successful response`, async () => {
    mockFetchShapeRows.mockResolvedValueOnce([
      { name: `chat` },
      { name: `agent` },
    ])

    const result = await fetchEntityTypeNames(ENV)
    expect(result).toEqual([`chat`, `agent`])
  })

  it(`returns empty array when fetch throws`, async () => {
    mockFetchShapeRows.mockRejectedValueOnce(new Error(`network error`))

    const result = await fetchEntityTypeNames(ENV)
    expect(result).toEqual([])
  })

  it(`returns empty array when no rows`, async () => {
    mockFetchShapeRows.mockResolvedValueOnce([])

    const result = await fetchEntityTypeNames(ENV)
    expect(result).toEqual([])
  })

  it(`filters out items with empty names`, async () => {
    mockFetchShapeRows.mockResolvedValueOnce([{ name: `valid` }, { name: `` }])

    const result = await fetchEntityTypeNames(ENV)
    expect(result).toEqual([`valid`])
  })
})

describe(`fetchEntityUrls`, () => {
  it(`returns entity URLs from a successful response`, async () => {
    mockFetchShapeRows.mockResolvedValueOnce([
      { url: `/chat/room-1` },
      { url: `/agent/bot-2` },
    ])

    const result = await fetchEntityUrls(ENV)
    expect(result).toEqual([`/chat/room-1`, `/agent/bot-2`])
  })

  it(`returns empty array when fetch throws`, async () => {
    mockFetchShapeRows.mockRejectedValueOnce(new Error(`network error`))

    const result = await fetchEntityUrls(ENV)
    expect(result).toEqual([])
  })

  it(`returns empty array when no rows`, async () => {
    mockFetchShapeRows.mockResolvedValueOnce([])

    const result = await fetchEntityUrls(ENV)
    expect(result).toEqual([])
  })
})
