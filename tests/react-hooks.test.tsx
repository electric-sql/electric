import 'global-jsdom/register'
// https://react-hooks-testing-library.com/usage/advanced-hooks#context

import React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, inject } from 'vitest'
import { setTimeout as sleep } from 'node:timers/promises'
import { testWithIssuesTable as it } from './support/test-context'
import { useShape } from '../react-hooks'
import { Message } from '../types'

type FC = React.FC<React.PropsWithChildren>
const BASE_URL = inject(`baseUrl`)

describe(`useShape`, () => {
  it(`should sync an empty shape`, async ({ aborter, issuesTableUrl }) => {
    const wrapper: FC = ({ children }) => {
      return <div>{children}</div>
    }

    const { result } = renderHook(
      () =>
        useShape({
          baseUrl: BASE_URL,
          shape: { table: issuesTableUrl },
          signal: aborter.signal,
          subscribe: false,
        }),
      { wrapper }
    )

    await waitFor(() => expect(result.current).toEqual([]))
  })

  it(`should sync a shape`, async ({
    aborter,
    issuesTableUrl,
    insertIssues,
  }) => {
    const [id] = await insertIssues({ title: `test row` })

    const wrapper: FC = ({ children }) => {
      return <div>{children}</div>
    }

    const { result } = renderHook(
      () =>
        useShape({
          baseUrl: BASE_URL,
          shape: { table: issuesTableUrl },
          signal: aborter?.signal,
          subscribe: false,
        }),
      { wrapper }
    )

    await waitFor(() =>
      expect(result.current).toEqual([{ id: id, title: `test row` }])
    )
  })

  it(`should keep the state value in sync`, async ({
    aborter,
    issuesTableUrl,
    insertIssues,
  }) => {
    const [id] = await insertIssues({ title: `test row` })

    const wrapper: FC = ({ children }) => {
      return <div>{children}</div>
    }

    const { result } = renderHook(
      () =>
        useShape({
          baseUrl: BASE_URL,
          shape: { table: issuesTableUrl },
          signal: aborter.signal,
          subscribe: true,
        }),
      { wrapper }
    )

    await waitFor(() => expect(result.current).not.toEqual([]))

    // Add an item.
    const [id2] = await insertIssues({ title: `other row` })

    await waitFor(() =>
      expect(result.current).toEqual([
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
      return <div>{children}</div>
    }

    const { result, unmount } = renderHook(
      () =>
        useShape({
          baseUrl: BASE_URL,
          shape: { table: issuesTableUrl },
          signal: aborter.signal,
          subscribe: true,
        }),
      { wrapper }
    )

    await waitFor(() => expect(result.current).not.toEqual([]))

    unmount()

    // Add another row to shape
    const [newId] = await insertIssues({ title: `other row` })
    // And wait until it's definitely seen
    await waitFor(async () => {
      const res = await fetch(`${BASE_URL}/shape/${issuesTableUrl}?offset=-1`)
      const body = (await res.json()) as Message[]
      expect(body).toMatchObject([{}, { value: { id: newId } }, {}])
    })

    await sleep(50)

    expect(result.current.length).toEqual(1)
  })
})
