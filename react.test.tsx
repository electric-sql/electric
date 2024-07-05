import 'global-jsdom/register'
// https://react-hooks-testing-library.com/usage/advanced-hooks#context

import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'

type FC = React.FC<React.PropsWithChildren>

import { Client } from "pg"
import { v4 as uuidv4 } from "uuid"
import {
  afterAll,
  afterEach,
  assert,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from "vitest"

import { useShape } from "./react-hooks"

let context: {
  aborter?: AbortController,
  client: Client,
  tablename: string
}

const throwIfNotTrue = (stmt: unknown, msg = 'Assertion failed.'): void => {
  if (!stmt) {
    throw new Error(msg)
  }
}

/*
 * We need to work hard to get proper seperation between tests.
 *
 * The database has a replication stream.
 * The sync service has shape logs.
 *
 * So, we isolote each test to its own table and we clean
 * up the DB and shape log after each test.
 */
beforeAll(async () => {
  const client = new Client({
    host: `localhost`,
    port: 54321,
    password: `password`,
    user: `postgres`,
    database: `electric`,
  })
  await client.connect()

  context = { client }

  return async () => {
    await context.client.end()
  }
})
beforeEach(async () => {
  const aborter = new AbortController()

  const tablename = `items${uuidv4().replaceAll('-', '').slice(25)}`
  await context.client.query(
    `CREATE TABLE ${tablename} (
      id UUID PRIMARY KEY,
      title TEXT NOT NULL
    );`
  )

  context.aborter = aborter
  context.tablename = tablename

  return async () => {
    aborter.abort()

    const resp = await fetch(
      `http://localhost:3000/shape/${tablename}`, {
        method: 'DELETE'
      }
    )

    await context.client.query(`DROP TABLE ${tablename}`)
  }
})

describe(`useShape`, () => {
  it(`should sync an empty shape`, async () => {
    const { aborter, tablename } = context

    const wrapper: FC = ({ children }) => {
      return <div>{children}</div>
    }

    const { result } = renderHook(() => useShape({
      baseUrl: `http://localhost:3000`,
      shape: { table: tablename },
      signal: aborter.signal,
      subscribe: false
    }), { wrapper })

    await waitFor(() => throwIfNotTrue(result.current.length == 0))
  })

  it(`should sync a shape`, async () => {
    const { aborter, client, tablename } = context

    // Add an item.
    const id = uuidv4()
    const title = `Test3 ${id}`
    await client.query(`insert into ${tablename} (id, title) values ($1, $2)`, [id, title])

    const wrapper: FC = ({ children }) => {
      return <div>{children}</div>
    }

    const { result } = renderHook(() => useShape({
      baseUrl: `http://localhost:3000`,
      shape: { table: tablename },
      signal: aborter.signal,
      subscribe: false
    }), { wrapper })

    await waitFor(() => throwIfNotTrue(result.current.length > 0))

    expect(result.current).toEqual([{
      "id": id,
      "title": title,
    }])
  })

  it(`should keep the state value in sync`, async () => {
    const { aborter, client, tablename } = context

    // Add an item.
    const id = uuidv4()
    const title = `Test3 ${id}`
    await client.query(`insert into ${tablename} (id, title) values ($1, $2)`, [id, title])

    const wrapper: FC = ({ children }) => {
      return <div>{children}</div>
    }

    const { result } = renderHook(() => useShape({
      baseUrl: `http://localhost:3000`,
      shape: { table: tablename },
      signal: aborter.signal,
      subscribe: true
    }), { wrapper })

    await waitFor(() => throwIfNotTrue(result.current.length > 0))
    const initialValue = result.current

    // Add an item.
    const id2 = uuidv4()
    const title2 = `Test3 ${id}`
    await client.query(`insert into ${tablename} (id, title) values ($1, $2)`, [id2, title2])

    await waitFor(() => throwIfNotTrue(result.current.length > 1))

    expect(result.current).toEqual([
      {
        "id": id,
        "title": title,
      },
      {
        "id": id2,
        "title": title2,
      }
    ])
  })

  it(`should unmount cleanly`, async () => {
    const { aborter, client, tablename } = context

    // Add an item.
    const id = uuidv4()
    const title = `Test3 ${id}`
    await client.query(`insert into ${tablename} (id, title) values ($1, $2)`, [id, title])

    const wrapper: FC = ({ children }) => {
      return <div>{children}</div>
    }

    const { result, unmount } = renderHook(() => useShape({
      baseUrl: `http://localhost:3000`,
      shape: { table: tablename },
      signal: aborter.signal,
      subscribe: true
    }), { wrapper })

    await waitFor(() => throwIfNotTrue(result.current.length > 0))

    unmount()

    // Add an item.
    const id2 = uuidv4()
    const title2 = `Test3 ${id}`
    await client.query(`insert into ${tablename} (id, title) values ($1, $2)`, [id2, title2])

    await new Promise((resolve) => setTimeout(resolve), 200)

    expect(result.current.length).toEqual(1)
  })
})
