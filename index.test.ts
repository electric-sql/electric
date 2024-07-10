import { beforeAll, afterAll, describe, it, expect, assert } from 'vitest'
import { ShapeStream } from './client'
import { v4 as uuidv4 } from 'uuid'
import { parse } from 'cache-control-parser'
import { Client } from 'pg'

const BASE_URL = `http://localhost:3000`

let context:
  | { client: Client; rowId?: string; secondRowId?: string }
  | Record<string, never> = {}

async function appendRow({ title }: { title: string }) {
  console.log(`appending row`, { title })
  const uuid = uuidv4()
  try {
    await context.client.query(`insert into issues(id, title) values($1, $2)`, [
      uuid,
      title,
    ])
  } catch (e) {
    console.log(e)
    throw e
  }

  return uuid
}

async function updateRow({ id, title }: { id: string; title: string }) {
  console.log(`updating row`, { id, title })
  try {
    await context.client.query(`update issues set title = $1 where id = $2`, [
      title,
      id,
    ])
  } catch (e) {
    console.log(e)
  }
}

beforeAll(async () => {
  const client = new Client({
    host: `localhost`,
    port: 54321,
    password: `password`,
    user: `postgres`,
    database: `electric`,
  })
  await client.connect()
  //
  // Add an initial row.
  const uuid = uuidv4()
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS issues (
          id UUID PRIMARY KEY,
          title TEXT NOT NULL
      );`,
      []
    )
    await client.query(
      `CREATE TABLE IF NOT EXISTS foo (
        id UUID PRIMARY KEY,
        title TEXT NOT NULL
    );`,
      []
    )
    await client.query(`insert into foo(id, title) values($1, $2)`, [
      uuid,
      `I AM FOO TABLE`,
    ])
  } catch (e) {
    console.log(e)
    throw e
  }

  context = { client }
})

afterAll(async () => {
  console.log(`afterAll`)
  await context.client.query(`TRUNCATE TABLE issues`)
  await context.client.query(`TRUNCATE TABLE foo`)
  await context.client.end()

  // TODO do any needed server cleanup.
  context = {}
})

describe(`HTTP Sync`, () => {
  it(`should work with empty shape/table`, async () => {
    // Get initial data
    const shapeData = new Map()
    const aborter = new AbortController()
    const issueStream = new ShapeStream({
      shape: { table: `issues` },
      baseUrl: `${BASE_URL}`,
      subscribe: false,
      signal: aborter.signal,
    })

    await new Promise<void>((resolve) => {
      issueStream.subscribe((messages) => {
        messages.forEach((message) => {
          if (message.headers?.[`action`] !== undefined) {
            shapeData.set(message.key, message.value)
          }
          if (message.headers?.[`control`] === `up-to-date`) {
            aborter.abort()
            return resolve()
          }
        })
      })
    })
    const values = [...shapeData.values()]

    expect(values).toHaveLength(0)
  })

  it(`returns a header with the server shape id`, async () => {
    const res = await fetch(`${BASE_URL}/shape/issues?offset=-1`, {})
    const shapeId = res.headers.get(`x-electric-shape-id`)
    assert.exists(shapeId)
  })

  it(`should get initial data`, async () => {
    const { client } = context
    // Add an initial row.
    const uuid = uuidv4()
    context.rowId = uuid
    try {
      await client.query(`insert into issues(id, title) values($1, $2)`, [
        uuid,
        `foo + ${uuid}`,
      ])
    } catch (e) {
      console.log(e)
      throw e
    }

    // Get initial data
    const shapeData = new Map()
    const aborter = new AbortController()
    const issueStream = new ShapeStream({
      shape: { table: `issues` },
      baseUrl: `${BASE_URL}`,
      subscribe: false,
      signal: aborter.signal,
    })

    await new Promise<void>((resolve) => {
      issueStream.subscribe((messages) => {
        console.log(messages)
        messages.forEach((message) => {
          if (message.headers?.[`action`] !== undefined) {
            shapeData.set(message.key, message.value)
          }
          if (message.headers?.[`control`] === `up-to-date`) {
            aborter.abort()
            return resolve()
          }
        })
      })
    })
    const values = [...shapeData.values()]

    expect(values).toHaveLength(1)
    expect(values[0].title).toEqual(`foo + ${uuid}`)
  })

  it(`should get initial data for a second table`, async () => {
    // Get initial data
    const shapeData = new Map()
    const aborter = new AbortController()
    const fooStream = new ShapeStream({
      shape: { table: `foo` },
      baseUrl: `${BASE_URL}`,
      subscribe: false,
      signal: aborter.signal,
    })

    await new Promise<void>((resolve) => {
      fooStream.subscribe((messages) => {
        messages.forEach(async (message) => {
          if (message.headers?.[`action`] !== undefined) {
            shapeData.set(message.key, message.value)
          }
          if (message.headers?.[`control`] === `up-to-date`) {
            aborter.abort()
            return resolve()
          }
        })
      })
    })
    const values = [...shapeData.values()]

    expect(values).toMatchObject([{title: `I AM FOO TABLE`}])
  })

  it(`should get initial data and then receive updates`, async () => {
    const { rowId } = context
    assert(rowId !== undefined, `rowId should be defined`)
    const shapeData = new Map()
    const aborter = new AbortController()
    const issueStream = new ShapeStream({
      shape: { table: `issues` },
      baseUrl: `${BASE_URL}`,
      subscribe: true,
      signal: aborter.signal,
    })
    let messageCount = 0
    let secondRowId = ``
    await new Promise<void>((resolve) => {
      issueStream.subscribe((messages) => {
        messages.forEach(async (message) => {
          if (message.headers?.[`action`] !== undefined) {
            shapeData.set(message.key, message.value)
            messageCount++
            console.log(`Processing msg`, messageCount, message)

            if (messageCount === 2) {
              updateRow({ id: rowId, title: `foo1` })
            }
            if (messageCount === 3) {
              secondRowId = await appendRow({ title: `foo2` })
            }

            if (messageCount === 4) {
              aborter.abort()
              expect(shapeData).toEqual(
                new Map([
                  [`"public"."issues"/` + rowId, { id: rowId, title: `foo1` }],
                  [
                    `"public"."issues"/` + secondRowId,
                    { id: secondRowId, title: `foo2` },
                  ],
                ])
              )
              resolve()
            }
          }
        })
      })
    })
    context.secondRowId = secondRowId
  })
  it(`multiple clients can get the same data`, async () => {
    const { rowId, secondRowId } = context
    assert(rowId !== undefined, `rowId should be defined`)
    assert(secondRowId !== undefined, `secondRowId should be defined`)
    const shapeData1 = new Map()
    const aborter1 = new AbortController()
    const issueStream1 = new ShapeStream({
      shape: { table: `issues` },
      baseUrl: `${BASE_URL}`,
      subscribe: true,
      signal: aborter1.signal,
    })

    const shapeData2 = new Map()
    const aborter2 = new AbortController()
    const issueStream2 = new ShapeStream({
      shape: { table: `issues` },
      baseUrl: `${BASE_URL}`,
      subscribe: true,
      signal: aborter2.signal,
    })

    let messageCount1 = 0
    let messageCount2 = 0
    const promise1 = new Promise<void>((resolve) => {
      issueStream1.subscribe((messages) => {
        messages.forEach(async (message) => {
          if (message.headers?.[`action`] !== undefined) {
            shapeData1.set(message.key, message.value)
            messageCount1++
            if (messageCount1 === 4) {
              setTimeout(() => updateRow({ id: rowId, title: `foo3` }), 50)
            }

            if (messageCount1 === 5) {
              aborter1.abort()
              expect(shapeData1).toEqual(
                new Map([
                  [`"public"."issues"/` + rowId, { id: rowId, title: `foo3` }],
                  [
                    `"public"."issues"/` + secondRowId,
                    { id: secondRowId, title: `foo2` },
                  ],
                ])
              )
              resolve()
            }
          }
        })
      })
    })

    const promise2 = new Promise<void>((resolve) => {
      issueStream2.subscribe((messages) => {
        messages.forEach(async (message) => {
          if (message.headers?.[`action`] !== undefined) {
            shapeData2.set(message.key, message.value)
            messageCount2++
            if (messageCount2 === 5) {
              aborter2.abort()
              expect(shapeData2).toEqual(
                new Map([
                  [`"public"."issues"/` + rowId, { id: rowId, title: `foo3` }],
                  [
                    `"public"."issues"/` + secondRowId,
                    { id: secondRowId, title: `foo2` },
                  ],
                ])
              )
              resolve()
            }
          }
        })
      })
    })

    await Promise.all([promise1, promise2])
  })

  it(`can go offline and then catchup`, async () => {
    const aborter = new AbortController()
    let lastOffset = 0
    const issueStream = new ShapeStream({
      shape: { table: `issues` },
      baseUrl: `${BASE_URL}`,
      subscribe: false,
      signal: aborter.signal,
    })
    await new Promise<void>((resolve) => {
      issueStream.subscribe((messages) => {
        messages.forEach(async (message) => {
          if (message.offset) {
            lastOffset = Math.max(lastOffset, message.offset)
          }

          if (message.headers?.[`control`] === `up-to-date`) {
            aborter.abort()
            resolve()
          }
        })
      })
    })

    const id = await appendRow({ title: `foo5` })
    await appendRow({ title: `foo6` })
    await appendRow({ title: `foo7` })
    await appendRow({ title: `foo8` })
    await appendRow({ title: `foo9` })
    await appendRow({ title: `foo10` })
    await appendRow({ title: `foo11` })
    await appendRow({ title: `foo12` })
    await appendRow({ title: `foo13` })
    await new Promise((resolve) => setTimeout(resolve, 10))
    // Add message — which the server should then overwrite the original appendRow
    // meaning there won't be an extra operation.
    // updateRow({ id, title: `--foo5` })
    // Wait for server to get all the messages.
    await new Promise((resolve) => setTimeout(resolve, 60))

    let catchupOpsCount = 0
    const newAborter = new AbortController()
    const newIssueStream = new ShapeStream({
      shape: { table: `issues` },
      baseUrl: `${BASE_URL}`,
      subscribe: true,
      signal: newAborter.signal,
      offset: lastOffset,
      shapeId: issueStream.shapeId,
    })
    await new Promise<void>((resolve) => {
      newIssueStream.subscribe((messages) => {
        messages.forEach(async (message) => {
          if (message.headers?.[`action`] !== undefined) {
            catchupOpsCount += 1
          }
          if (message.headers?.[`control`] === `up-to-date`) {
            newAborter.abort()
            resolve()
          }
        })
      })
    })

    expect(catchupOpsCount).toBe(9)
  })

  it(`should return correct caching headers`, async () => {
    const res = await fetch(`${BASE_URL}/shape/issues?offset=-1`, {})
    const cacheHeaders = res.headers.get(`cache-control`)
    assert(cacheHeaders !== null, `Response should have cache-control header`)
    const directives = parse(cacheHeaders)
    expect(directives).toEqual({ 'max-age': 1, 'stale-while-revalidate': 3 })
    const etagHeader = res.headers.get(`etag`)
    assert(etagHeader !== null, `Response should have etag header`)

    await appendRow({ title: `foo4` })
    await appendRow({ title: `foo5` })
    await appendRow({ title: `foo6` })
    await appendRow({ title: `foo7` })
    await appendRow({ title: `foo8` })
    // Wait for server to get all the messages.
    await new Promise((resolve) => setTimeout(resolve, 40))

    const res2 = await fetch(`${BASE_URL}/shape/issues?offset=-1`, {})
    const etag2Header = res2.headers.get(`etag`)
    assert(etag2Header !== null, `Response should have etag header`)
    console.log({ etagHeader, etag2Header })
    // assert(etagHeader !== etag2Header, `Etags should change when log grows`)
  })

  // We can't test this from the client as this just holds for 20 seconds (the default
  // timeout for long-polling)
  // it(`should return as uncachable if &live is set`, async () => {
    // const initialRes = await fetch(`${BASE_URL}/shape/issues?offset=-1`, {})
    // const initialcacheHeaders = initialRes.headers.get(`cache-control`)
    // const messages = await initialRes.json()
    // const lastOffset = messages.slice(-2)[0].offset
    // console.log({lastOffset, headers: initialRes.headers, cacheHeaders: initialcacheHeaders, status: initialRes.status})

    // const shapeId = initialRes.headers.get(`x-electric-shape-id`)
    // const res = await fetch(
      // `${BASE_URL}/shape/issues?offset=${lastOffset}&live&shape_id=${shapeId}`
    // )
    // const cacheHeaders = res.headers.get(`cache-control`)
    // console.log({cacheHeaders, status: res.status})
    // assert(cacheHeaders !== null, `Response should have cache-control header`)
    // const directives = parse(cacheHeaders)
    // expect(directives).toEqual({
      // 'no-store': true,
      // 'no-cache': true,
      // 'must-revalidate': true,
      // 'max-age': 0,
    // })
    // const pragma = res.headers.get(`pragma`)
    // expect(pragma).toEqual(`no-cache`)

    // const etagHeader = res.headers.get(`etag`)
    // console.log(etagHeader)
    // assert(etagHeader === null)
  // })

  it(`should revalidate etags`, async () => {
    const res = await fetch(`${BASE_URL}/shape/issues?offset=-1`, {})
    const messages = await res.json()
    const midOffset = messages.slice(-6)[0].offset
    const shapeId = res.headers.get(`x-electric-shape-id`)
    const etag = res.headers.get(`etag`)
    console.log({etag})
    assert(etag !== null, `Response should have etag header`)

    const etagValidation = await fetch(`${BASE_URL}/shape/issues?offset=-1`, {
      headers: { 'If-None-Match': etag },
    })

    const status = etagValidation.status
    expect(status).toEqual(304)

    // Get etag for catchup
    const catchupEtagRes = await fetch(
      `${BASE_URL}/shape/issues?offset=${midOffset}&shape_id=${shapeId}`,
      {}
    )
    console.log(catchupEtagRes)
    const catchupEtag = catchupEtagRes.headers.get(`etag`)
    assert(catchupEtag !== null, `Response should have catchup etag header`)
    console.log({catchupEtag})

    // Catch-up offsets should also use the same etag as they're
    // also working through the end of the current log.
    const catchupEtagValidation = await fetch(
      `${BASE_URL}/shape/issues?offset=${midOffset}&shape_id=${shapeId}`,
      {
        headers: { 'If-None-Match': catchupEtag },
      }
    )
    const catchupStatus = catchupEtagValidation.status
    expect(catchupStatus).toEqual(304)
  })

  // TODO figure out a way to disable the Electric server during a test so we can
  // test temporary offline episodes (or if there a way to disable networking
  // in node.js temporarily?)
  //
  // it(`the client should be resiliant against network/server interuptions`, async () => {
  // const { rowId } = context
  // const aborter = new AbortController()
  // const issueStream = new ShapeStream({
  // shape: { table: `issues` },
  // baseUrl: `${BASE_URL}`,
  // subscribe: true,
  // signal: aborter.signal,
  // })

  // const secondRowId = ``
  // let maxOffset = 0
  // let offsetBeforeUpdate = 10000
  // await new Promise<void>((resolve) => {
  // issueStream.subscribe(async (messages) => {
  // messages.forEach(async (message) => {
  // if (typeof message.offset === `number`) {
  // maxOffset = Math.max(maxOffset, message.offset)
  // if (message.offset > offsetBeforeUpdate) {
  // toggleNetworkConnectivity()
  // aborter.abort()
  // return resolve()
  // }
  // }
  // if (message.headers?.[`control`] === `up-to-date`) {
  // offsetBeforeUpdate = maxOffset
  // toggleNetworkConnectivity()
  // updateRow({ id: rowId, title: `foo1` })
  // await new Promise<void>((resolve) => setTimeout(resolve, 50))
  // toggleNetworkConnectivity()
  // }
  // })
  // })
  // })
  // context.secondRowId = secondRowId
  // })
  // TODO fetch, delete shape, fetch again with header and get error
  // it(`should return "must-refetch" as only log entry if the shapeId has changed`, async () => {
  //   const initialRes = await fetch(`${BASE_URL}/shape/issues`, {})
  //   const shapeId = initialRes.headers.get(`x-electric-shape-id`)

  //   deleteShape(`issues`)

  //   const res = await fetch(
  //     `${BASE_URL}/shape/issues?offset=10&live&shape_id=${shapeId}`
  //   )

  //   const data = await res.json()
  //   expect(data).toEqual([{ headers: { control: `must-refetch` } }])
  // })
})
