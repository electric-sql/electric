import 'global-jsdom/register'
// https://react-hooks-testing-library.com/usage/advanced-hooks#context

import React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, inject, it as bareIt } from 'vitest'
import { setTimeout as sleep } from 'node:timers/promises'
import { testWithIssuesTable as it } from './support/test-context'
import { useShape, ShapesProvider, sortedOptionsHash } from '../src/react-hooks'
import { Shape, Message } from '@electric-sql/next'

type FC = React.FC<React.PropsWithChildren>
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
    const wrapper: FC = ({ children }) => {
      return <ShapesProvider>{children}</ShapesProvider>
    }

    const { result } = renderHook(
      () =>
        useShape({
          url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
          signal: aborter.signal,
          subscribe: false,
        }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.isUpToDate).toEqual(true))
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

    const wrapper: FC = ({ children }) => {
      return <ShapesProvider>{children}</ShapesProvider>
    }

    const { result } = renderHook(
      () =>
        useShape({
          url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
          signal: aborter?.signal,
          subscribe: false,
        }),
      { wrapper }
    )

    await waitFor(() =>
      expect(result.current.data).toEqual([{ id: id, title: `test row` }])
    )
  })

  it(`should keep the state value in sync`, async ({
    aborter,
    issuesTableUrl,
    insertIssues,
  }) => {
    const [id] = await insertIssues({ title: `test row` })

    const wrapper: FC = ({ children }) => {
      return <ShapesProvider>{children}</ShapesProvider>
    }

    const { result } = renderHook(
      () =>
        useShape({
          url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
          signal: aborter.signal,
          subscribe: true,
        }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.data).not.toEqual([]))

    // Add an item.
    const [id2] = await insertIssues({ title: `other row` })

    await waitFor(() =>
      expect(result.current.data).toEqual([
        { id: id, title: `test row` },
        { id: id2, title: `other row` },
      ])
    )
  })

  it(`should allow use of the "selector" api from useSyncExternalStoreWithSelector`, async ({
    aborter,
    issuesTableUrl,
    insertIssues,
  }) => {
    const [id] = await insertIssues({ title: `test row` })
    await insertIssues({ title: `test row2` })

    const wrapper: FC = ({ children }) => {
      return <ShapesProvider>{children}</ShapesProvider>
    }

    const { result } = renderHook(
      () =>
        useShape({
          url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
          signal: aborter.signal,
          subscribe: true,
          selector: (result) => {
            result.data = result.data.filter(
              (row) => row?.title !== `test row2`
            )
            return result
          },
        }),
      { wrapper }
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

  it(`should unmount cleanly`, async ({
    aborter,
    issuesTableUrl,
    insertIssues,
  }) => {
    await insertIssues({ title: `test row` })

    const wrapper: FC = ({ children }) => {
      return <ShapesProvider>{children}</ShapesProvider>
    }

    const { result, unmount } = renderHook(
      () =>
        useShape({
          url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
          signal: aborter.signal,
          subscribe: true,
        }),
      { wrapper }
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
      expect(body).toMatchObject([{}, { value: { id: newId } }, {}])
    })

    await sleep(50)

    expect(result.current.data.length).toEqual(1)
  })
})
