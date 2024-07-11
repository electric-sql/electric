import { Client } from 'pg'
import { v4 as uuidv4 } from 'uuid'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { Shape } from './client'

let context: {
  aborter?: AbortController
  client: Client
  tableName: string
}

const addItem = async (client, tableName, testName = `Test`) => {
  const id = uuidv4()
  const title = `${testName} ${id}`

  await client.query(
    `INSERT INTO ${tableName} (
        id,
        title
      )
      VALUES (
        $1,
        $2
    )`,
    [id, title]
  )

  return { id, title }
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

  const tableName = `items${uuidv4().replaceAll(`-`, ``).slice(25)}`
  await context.client.query(
    `CREATE TABLE ${tableName} (
      id UUID PRIMARY KEY,
      title TEXT NOT NULL
    );`
  )

  context.aborter = aborter
  context.tableName = tableName

  return async () => {
    aborter.abort()

    try {
      await fetch(`http://localhost:3000/shape/${tableName}`, {
        method: `DELETE`,
      })
    } catch (e) {
      // ignore
    }

    await context.client.query(`DROP TABLE ${tableName}`)
  }
})

describe(`Shape`, () => {
  it(`should sync an empty shape`, async () => {
    const { tableName } = context

    const shape = new Shape({
      shape: { table: tableName },
      baseUrl: `http://localhost:3000`,
    })
    const map = await shape.isUpToDate

    expect(map).toEqual(new Map())
  })

  it(`should notify with the initial value`, async () => {
    const { client, tableName } = context

    const { id, title } = await addItem(client, tableName)

    const shape = new Shape({
      shape: { table: tableName },
      baseUrl: `http://localhost:3000`,
    })

    const hasNotified = new Promise((resolve) => {
      shape.subscribe(resolve)
    })
    // shape.()
    const map = await hasNotified

    const expectedValue = new Map()
    expectedValue.set(`"public"."${tableName}"/${id}`, {
      id: id,
      title: title,
    })

    expect(map).toEqual(expectedValue)
  })

  it(`should continually sync a shape/table`, async () => {
    const { client, tableName } = context

    const { id, title } = await addItem(client, tableName)

    const shape = new Shape({
      shape: { table: tableName },
      baseUrl: `http://localhost:3000`,
    })
    const map = await shape.isUpToDate

    const expectedValue = new Map()
    expectedValue.set(`"public"."${tableName}"/${id}`, {
      id: id,
      title: title,
    })
    expect(map).toEqual(expectedValue)

    const hasNotified = new Promise((resolve) => {
      shape.subscribe(resolve)
    })
    const { id: id2, title: title2 } = await addItem(client, tableName)
    await hasNotified

    expectedValue.set(`"public"."${tableName}"/${id2}`, {
      id: id2,
      title: title2,
    })
    expect(shape.value).toEqual(expectedValue)

    shape.unsubscribeAll()
  })

  it(`should notify subscribers when the value changes`, async () => {
    const { client, tableName } = context

    const { id, title } = await addItem(client, tableName)

    const shape = new Shape({
      shape: { table: tableName },
      baseUrl: `http://localhost:3000`,
    })

    const hasNotified = new Promise((resolve) => {
      shape.subscribe(resolve)
    })

    const { id: id2, title: title2 } = await addItem(client, tableName)

    const value = await hasNotified
    const expectedValue = new Map()
    expectedValue.set(`"public"."${tableName}"/${id}`, {
      id: id,
      title: title,
    })
    expectedValue.set(`"public"."${tableName}"/${id2}`, {
      id: id2,
      title: title2,
    })
    expect(value).toEqual(expectedValue)

    shape.unsubscribeAll()
  })

  it(`should support unsubscribe`, async () => {
    const { tableName } = context

    const shape = new Shape({
      shape: { table: tableName },
      baseUrl: `http://localhost:3000`,
    })

    const unsubscribeFn = shape.subscribe(console.log)
    unsubscribeFn()

    expect(shape.numSubscribers).toBe(0)
  })
})
