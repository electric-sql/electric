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

import { Shape, ShapeStream } from "./client"

let context: {
  aborter?: AbortController,
  client: Client,
  tablename: string
}

const addItem = async (client, tablename, testName = 'Test') => {
  const id = uuidv4()
  const title = `${testName} ${id}`

  await client.query(
    `INSERT INTO ${tablename} (
        id,
        title
      )
      VALUES (
        $1,
        $2
    )`, [
      id,
      title
    ]
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

describe(`Shape`, () => {
  it(`should syncOnce an empty shape`, async () => {
    const { tablename } = context

    const opts = {baseUrl: `http://localhost:3000`}
    const shape = new Shape({ table: tablename }, opts)
    const map = await shape.syncOnce()

    expect(map).toEqual(new Map())
  })

  it(`should sync an empty shape`, async () => {
    const { tablename } = context

    const opts = {baseUrl: `http://localhost:3000`}
    const shape = new Shape({ table: tablename }, opts)
    const map = await shape.sync()

    expect(map).toEqual(new Map())
  })

  it(`should initially syncOnce a shape/table`, async () => {
    const { client, tablename } = context

    const { id, title } = await addItem(client, tablename)

    const opts = {baseUrl: `http://localhost:3000`}
    const shape = new Shape({ table: tablename }, opts)
    const map = await shape.syncOnce()

    const expectedValue = new Map()
    expectedValue.set(`"public"."${tablename}"/${id}`, {
      "id": id,
      "title": title,
    })

    expect(map).toEqual(expectedValue)
  })

  it(`should notify with the initial value`, async () => {
    const { client, tablename } = context

    const { id, title } = await addItem(client, tablename)

    const opts = {baseUrl: `http://localhost:3000`}
    const shape = new Shape({ table: tablename }, opts)

    const hasNotified = new Promise((resolve) => {
      shape.subscribe(resolve)
    })
    shape.syncOnce()
    const map = await hasNotified

    const expectedValue = new Map()
    expectedValue.set(`"public"."${tablename}"/${id}`, {
      "id": id,
      "title": title,
    })

    expect(map).toEqual(expectedValue)
  })

  it(`should continually sync a shape/table`, async () => {
    const { client, tablename } = context

    const { id, title } = await addItem(client, tablename)

    const opts = {baseUrl: `http://localhost:3000`}
    const shape = new Shape({ table: tablename }, opts)
    const map = await shape.sync()

    const expectedValue = new Map()
    expectedValue.set(`"public"."${tablename}"/${id}`, {
      "id": id,
      "title": title,
    })
    expect(map).toEqual(expectedValue)

    const hasNotified = new Promise((resolve) => {
      shape.subscribe(resolve)
    })
    const { id: id2, title: title2 } = await addItem(client, tablename)
    await hasNotified

    expectedValue.set(`"public"."${tablename}"/${id2}`, {
      "id": id2,
      "title": title2,
    })
    expect(shape.value).toEqual(expectedValue)

    shape.unsubscribeAll()
  })

  it(`should notify subscribers when the value changes`, async () => {
    const { client, tablename } = context

    const { id, title } = await addItem(client, tablename)

    const opts = {baseUrl: `http://localhost:3000`}
    const shape = new Shape({ table: tablename }, opts)
    const map = await shape.sync()

    const hasNotified = new Promise((resolve) => {
      shape.subscribe(resolve)
    })

    const { id: id2, title: title2 } = await addItem(client, tablename)

    const value = await hasNotified
    const expectedValue = new Map()
    expectedValue.set(`"public"."${tablename}"/${id}`, {
      "id": id,
      "title": title,
    })
    expectedValue.set(`"public"."${tablename}"/${id2}`, {
      "id": id2,
      "title": title2,
    })
    expect(value).toEqual(expectedValue)

    shape.unsubscribeAll()
  })

  it(`should support unsubscribe`, async () => {
    const { tablename } = context

    const opts = {baseUrl: `http://localhost:3000`}
    const shape = new Shape({ table: tablename }, opts)

    const unsubscribeFn = shape.subscribe(console.log)
    unsubscribeFn()

    expect(shape.numSubscribers).toBe(0)
  })

  it(`should support multiple syncOnce calls`, async () => {
    const { tablename } = context

    const opts = {baseUrl: `http://localhost:3000`}
    const shape = new Shape({ table: tablename }, opts)
    await shape.syncOnce()
    const data = await shape.syncOnce()

    expect(data).toEqual(new Map())
  })

  it(`should support incrementally syncing through multiple syncOnce calls`, async () => {
    const { client, tablename } = context

    const opts = {baseUrl: `http://localhost:3000`}
    const shape = new Shape({ table: tablename }, opts)
    await shape.syncOnce()
    expect(shape.value.size).toEqual(0)

    const { id, title } = await addItem(client, tablename)
    const data = await shape.syncOnce()
    expect(data.size).toEqual(1)
  })

  it(`should support upgrading from syncOnce to sync`, async () => {
    const { client, tablename } = context

    const opts = {baseUrl: `http://localhost:3000`}
    const shape = new Shape({ table: tablename }, opts)
    await shape.syncOnce()
    expect(shape.value.size).toEqual(0)

    await addItem(client, tablename)
    let data = await shape.sync()
    expect(data.size).toEqual(1)

    const hasNotified = new Promise((resolve) => { shape.subscribe(resolve) })
    await addItem(client, tablename)
    data = await hasNotified
    expect(data.size).toEqual(2)
  })

  it.only(`should support downgrading from sync to syncOnce`, async () => {
    const { client, tablename } = context

    const opts = {baseUrl: `http://localhost:3000`}
    const shape = new Shape({ table: tablename }, opts)
    await shape.sync()
    expect(shape.value.size).toEqual(0)

    await shape.syncOnce()
    await addItem(client, tablename)

    await new Promise((resolve) => setTimeout(resolve), 100)
    expect(shape.value.size).toEqual(0)
  })
})
