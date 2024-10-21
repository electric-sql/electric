import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, inject, it as bareIt } from 'vitest'
import { setTimeout as sleep } from 'node:timers/promises'
import { testWithIssuesTable as it } from './support/test-context'
import { useShape, sortedOptionsHash, UseShapeResult } from '../src/react-hooks'
import { Shape, Message } from '@electric-sql/client'

const BASE_URL = inject(`baseUrl`)

describe(`sortedOptionsHash`, () => {
  bareIt(
    `should create the same hash from options sorted in different ways`,
    () => {
      const hash1 = sortedOptionsHash({
        url: `http://whatever/foo`,
        offset: `-1`,
      })
      const hash2 = sortedOptionsHash({
        offset: `-1`,
        url: `http://whatever/foo`,
      })
      expect(hash1).toEqual(hash2)
    }
  )
})

describe(`useShape`, () => {
  it(`should sync an empty shape`, async ({ aborter, issuesTableUrl }) => {
    const { result } = renderHook(() =>
      useShape({
        url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
        signal: aborter.signal,
        subscribe: false,
      })
    )

    await waitFor(() => expect(result.current.error).toBe(false))
    await waitFor(() => expect(result.current.isError).toEqual(false))
    await waitFor(() => expect(result.current.data).toEqual([]))
    await waitFor(() => expect(result.current.shape).toBeInstanceOf(Shape))
  })

  it(`should sync a shape`, async ({
    aborter,
    issuesTableUrl,
    insertIssues,
  }) => {
    const [id] = await insertIssues({ title: `test row` })

    const { result } = renderHook(() =>
      useShape({
        url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
        signal: aborter?.signal,
        subscribe: false,
      })
    )

    await waitFor(() =>
      expect(result.current.data).toEqual([{ id: id, title: `test row` }])
    )
  })

  it(`should expose isLoading status`, async ({ issuesTableUrl }) => {
    const { result } = renderHook(() =>
      useShape({
        url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
        fetchClient: async (input, init) => {
          await sleep(10)
          return fetch(input, init)
        },
      })
    )

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.isLoading).toBe(false))
  })

  it(`should expose time at which we last synced`, async ({
    issuesTableUrl,
  }) => {
    const { result } = renderHook(() =>
      useShape({
        url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
        fetchClient: async (input, init) => {
          await sleep(50)
          return fetch(input, init)
        },
      })
    )

    expect(result.current.lastSyncedAt).toBeUndefined()
    const now = Date.now()

    await sleep(150)

    await waitFor(() => expect(result.current.lastSyncedAt).toBeDefined())

    expect(result.current.lastSyncedAt).toBeGreaterThanOrEqual(now)
  })

  it(`should keep the state value in sync`, async ({
    aborter,
    issuesTableUrl,
    insertIssues,
  }) => {
    const [id] = await insertIssues({ title: `test row` })

    const { result } = renderHook(() =>
      useShape({
        url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
        signal: aborter.signal,
        subscribe: true,
      })
    )

    await waitFor(() => expect(result.current.data).not.toEqual([]))

    // Add an item.
    const [id2] = await insertIssues({ title: `other row` })

    await waitFor(
      () =>
        expect(result.current.data).toEqual([
          { id: id, title: `test row` },
          { id: id2, title: `other row` },
        ]),
      { timeout: 4000 }
    )
  })

  it(`should let you change the shape definition (and clear the internal cache between)`, async ({
    aborter,
    issuesTableUrl,
    insertIssues,
  }) => {
    const [id] = await insertIssues({ title: `test row` })
    const [id2] = await insertIssues({ title: `test row2` })

    const { result, rerender } = renderHook((options) => useShape(options), {
      initialProps: {
        url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
        where: `id = '${id}'`,
        signal: aborter.signal,
        subscribe: true,
      },
    })

    await waitFor(() =>
      expect(result.current.data).toEqual([{ id: id, title: `test row` }])
    )

    rerender({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      where: `id = '${id2}'`,
      signal: aborter.signal,
      subscribe: true,
    })

    await waitFor(() =>
      expect(result.current.data).toEqual([{ id: id2, title: `test row2` }])
    )
  })

  it(`should allow use of the "selector" api from useSyncExternalStoreWithSelector`, async ({
    aborter,
    issuesTableUrl,
    insertIssues,
  }) => {
    const [id] = await insertIssues({ title: `test row` })
    await insertIssues({ title: `test row2` })

    const { result } = renderHook(() =>
      useShape({
        url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
        signal: aborter.signal,
        subscribe: true,
        selector: (result) => {
          result.data = result.data.filter((row) => row?.title !== `test row2`)
          return result
        },
      })
    )

    await waitFor(() =>
      expect(result.current.data).toEqual([{ id: id, title: `test row` }])
    )

    // Add an item.
    const [id2] = await insertIssues({ title: `other row` })

    await waitFor(() =>
      expect(result.current.data).toEqual([
        { id: id, title: `test row` },
        { id: id2, title: `other row` },
      ])
    )
  })

  it(`should correctly reapply the selector to the data if it changes`, async ({
    aborter,
    issuesTableUrl,
    insertIssues,
  }) => {
    const firstRow = `test row 1`
    const secondRow = `test row 2`
    const [id1] = await insertIssues({ title: firstRow })
    const [id2] = await insertIssues({ title: secondRow })

    const createSelector = (filterVal: string) => (result: UseShapeResult) => {
      result.data = result.data.filter((row) => row?.title !== filterVal)
      return result
    }

    const selectorA = createSelector(firstRow)
    const selectorB = createSelector(secondRow)

    const { result, rerender } = renderHook(
      ({ selector }) =>
        useShape({
          url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
          signal: aborter.signal,
          subscribe: true,
          selector: selector,
        }),
      { initialProps: { selector: selectorA } }
    )

    await waitFor(() =>
      expect(result.current.data).toEqual([{ id: id2, title: secondRow }])
    )

    rerender({ selector: selectorB })

    await waitFor(() =>
      expect(result.current.data).toEqual([{ id: id1, title: firstRow }])
    )
  })

  it(`should unmount cleanly`, async ({
    aborter,
    issuesTableUrl,
    insertIssues,
  }) => {
    await insertIssues({ title: `test row` })

    const { result, unmount } = renderHook(() =>
      useShape({
        url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
        signal: aborter.signal,
        subscribe: true,
      })
    )

    await waitFor(() => expect(result.current.data).not.toEqual([]))

    unmount()

    // Add another row to shape
    const [newId] = await insertIssues({ title: `other row` })
    // And wait until it's definitely seen
    await waitFor(async () => {
      const res = await fetch(
        `${BASE_URL}/v1/shape/${issuesTableUrl}?offset=-1`
      )
      const body = (await res.json()) as Message[]
      expect(body).toMatchObject([{}, { value: { id: newId } }])
    })

    await sleep(50)

    expect(result.current.data.length).toEqual(1)
  })
})
