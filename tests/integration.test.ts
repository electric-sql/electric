import { parse } from 'cache-control-parser'
import { setTimeout as sleep } from 'node:timers/promises'
import { v4 as uuidv4 } from 'uuid'
import { assert, describe, expect, inject, vi } from 'vitest'
import { ShapeStream } from '../client'
import { Message, Offset } from '../types'
import { testWithIssuesTable as it } from './support/test_context'
import * as h from './support/test_helpers'

const BASE_URL = inject(`baseUrl`)

it(`sanity check`, async ({ dbClient, issuesTableSql }) => {
  const result = await dbClient.query(`SELECT * FROM ${issuesTableSql}`)

  expect(result.rows).toEqual([])
})

describe(`HTTP Sync`, () => {
  it(`should work with empty shape/table`, async ({
    issuesTableUrl,
    aborter,
  }) => {
    // Get initial data
    const shapeData = new Map()
    const issueStream = new ShapeStream({
      shape: { table: issuesTableUrl },
      baseUrl: `${BASE_URL}`,
      subscribe: false,
      signal: aborter.signal,
    })

    await new Promise<void>((resolve, reject) => {
      issueStream.subscribe((messages) => {
        messages.forEach((message) => {
          if (`key` in message) {
            shapeData.set(message.key, message.value)
          }
          if (message.headers?.[`control`] === `up-to-date`) {
            aborter.abort()
            return resolve()
          }
        })
      }, reject)
    })
    const values = [...shapeData.values()]

    expect(values).toHaveLength(0)
  })

  it(`returns a header with the server shape id`, async ({
    issuesTableUrl,
  }) => {
    const res = await fetch(`${BASE_URL}/shape/${issuesTableUrl}?offset=-1`, {})
    const shapeId = res.headers.get(`x-electric-shape-id`)
    expect(shapeId).to.exist
  })

  it(`should get initial data`, async ({
    insertIssues,
    issuesTableUrl,
    aborter,
  }) => {
    // Add an initial row.
    const uuid = uuidv4()
    console.log(await insertIssues({ id: uuid, title: `foo + ${uuid}` }))

    // Get initial data
    const shapeData = new Map()
    const issueStream = new ShapeStream({
      shape: { table: issuesTableUrl },
      baseUrl: `${BASE_URL}`,
      subscribe: false,
      signal: aborter.signal,
    })

    await new Promise<void>((resolve) => {
      issueStream.subscribe((messages) => {
        messages.forEach((message) => {
          if (`key` in message) {
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

    expect(values).toMatchObject([{ title: `foo + ${uuid}` }])
  })

  it(`should get initial data and then receive updates`, async ({
    aborter,
    issuesTableUrl,
    issuesTableKey,
    updateIssue,
    insertIssues,
  }) => {
    // With initial data
    const rowId = uuidv4()
    await insertIssues({ id: rowId, title: `original insert` })

    const shapeData = new Map()
    const issueStream = new ShapeStream({
      shape: { table: issuesTableUrl },
      baseUrl: `${BASE_URL}`,
      subscribe: true,
      signal: aborter.signal,
    })
    let secondRowId = ``
    await h.forEachMessage(issueStream, aborter, async (res, msg, nth) => {
      if (!(`key` in msg)) return
      shapeData.set(msg.key, msg.value)

      if (nth === 0) {
        updateIssue({ id: rowId, title: `foo1` })
      } else if (nth === 1) {
        ;[secondRowId] = await insertIssues({ title: `foo2` })
      } else if (nth === 2) {
        res()
      }
    })

    expect(shapeData).toEqual(
      new Map([
        [`${issuesTableKey}/${rowId}`, { id: rowId, title: `foo1` }],
        [
          `${issuesTableKey}/${secondRowId}`,
          { id: secondRowId, title: `foo2` },
        ],
      ])
    )
  })

  it(`multiple clients can get the same data in parallel`, async ({
    issuesTableUrl,
    updateIssue,
    insertIssues,
  }) => {
    const rowId = uuidv4(),
      rowId2 = uuidv4()
    await insertIssues(
      { id: rowId, title: `first original insert` },
      { id: rowId2, title: `second original insert` }
    )

    const shapeData1 = new Map()
    const aborter1 = new AbortController()
    const issueStream1 = new ShapeStream({
      shape: { table: issuesTableUrl },
      baseUrl: `${BASE_URL}`,
      subscribe: true,
      signal: aborter1.signal,
    })

    const shapeData2 = new Map()
    const aborter2 = new AbortController()
    const issueStream2 = new ShapeStream({
      shape: { table: issuesTableUrl },
      baseUrl: `${BASE_URL}`,
      subscribe: true,
      signal: aborter2.signal,
    })

    const p1 = h.forEachMessage(issueStream1, aborter1, (res, msg, nth) => {
      if (!(`key` in msg)) return
      shapeData1.set(msg.key, msg.value)

      if (nth === 1) {
        setTimeout(() => updateIssue({ id: rowId, title: `foo3` }), 50)
      } else if (nth === 2) {
        return res()
      }
    })

    const p2 = h.forEachMessage(issueStream2, aborter2, (res, msg, nth) => {
      if (!(`key` in msg)) return
      shapeData2.set(msg.key, msg.value)

      if (nth === 2) {
        return res()
      }
    })

    await Promise.all([p1, p2])

    expect(shapeData1).toEqual(shapeData2)
  })

  it(`can go offline and then catchup`, async ({
    aborter,
    issuesTableUrl,
    insertIssues,
  }) => {
    await insertIssues({ title: `foo1` }, { title: `foo2` }, { title: `foo3` })
    await sleep(50)

    let lastOffset: Offset = `-1`
    const issueStream = new ShapeStream({
      shape: { table: issuesTableUrl },
      baseUrl: `${BASE_URL}`,
      subscribe: false,
      signal: aborter.signal,
    })

    await h.forEachMessage(issueStream, aborter, (res, msg) => {
      if (`offset` in msg) {
        expect(msg.offset).to.not.eq(`0_`)
        lastOffset = msg.offset
      } else if (msg.headers?.[`control`] === `up-to-date`) {
        res()
      }
    })

    await insertIssues(
      ...Array.from({ length: 9 }, (_, i) => ({ title: `foo${i + 5}` }))
    )

    // And wait until it's definitely seen
    await vi.waitFor(async () => {
      const res = await fetch(`${BASE_URL}/shape/${issuesTableUrl}?offset=-1`)
      const body = (await res.json()) as Message[]
      expect(body).toHaveLength(13)
    })

    let catchupOpsCount = 0
    const newAborter = new AbortController()
    const newIssueStream = new ShapeStream({
      shape: { table: issuesTableUrl },
      baseUrl: `${BASE_URL}`,
      subscribe: false,
      signal: newAborter.signal,
      offset: lastOffset,
      shapeId: issueStream.shapeId,
    })
    await h.forEachMessage(newIssueStream, aborter, (res, msg, nth) => {
      if (msg.headers?.[`control`] === `up-to-date`) {
        res()
      } else {
        catchupOpsCount = nth + 1
      }
    })

    expect(catchupOpsCount).toBe(9)
  })

  it(`should return correct caching headers`, async ({
    issuesTableUrl,
    insertIssues,
  }) => {
    const res = await fetch(`${BASE_URL}/shape/${issuesTableUrl}?offset=-1`, {})
    const cacheHeaders = res.headers.get(`cache-control`)
    assert(cacheHeaders !== null, `Response should have cache-control header`)
    const directives = parse(cacheHeaders)
    expect(directives).toEqual({ 'max-age': 1, 'stale-while-revalidate': 3 })
    const etagHeader = res.headers.get(`etag`)
    assert(etagHeader !== null, `Response should have etag header`)

    await insertIssues(
      { title: `foo4` },
      { title: `foo5` },
      { title: `foo6` },
      { title: `foo7` },
      { title: `foo8` }
    )
    // Wait for server to get all the messages.
    await sleep(40)

    const res2 = await fetch(
      `${BASE_URL}/shape/${issuesTableUrl}?offset=-1`,
      {}
    )
    const etag2Header = res2.headers.get(`etag`)
    expect(etag2Header !== null, `Response should have etag header`)
    expect(etagHeader).not.toEqual(etag2Header)
  })

  it(`should revalidate etags`, async ({ issuesTableUrl, insertIssues }) => {
    // Start the shape
    await fetch(`${BASE_URL}/shape/${issuesTableUrl}?offset=-1`, {})
    // Fill it up in separate transactions
    for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      await insertIssues({ title: `foo${i}` })
    }
    // Then wait for them to flow through the system
    await sleep(100)

    const res = await fetch(`${BASE_URL}/shape/${issuesTableUrl}?offset=-1`, {})
    const messages = (await res.json()) as Message[]
    expect(messages.length).toEqual(10) // 9 inserts + up-to-date
    const midMessage = messages.slice(-6)[0]
    assert(`offset` in midMessage)
    const midOffset = midMessage.offset
    const shapeId = res.headers.get(`x-electric-shape-id`)
    const etag = res.headers.get(`etag`)
    console.log({ etag })
    assert(etag !== null, `Response should have etag header`)

    const etagValidation = await fetch(
      `${BASE_URL}/shape/${issuesTableUrl}?offset=-1`,
      {
        headers: { 'If-None-Match': etag },
      }
    )

    const status = etagValidation.status
    expect(status).toEqual(304)

    // Get etag for catchup
    const catchupEtagRes = await fetch(
      `${BASE_URL}/shape/${issuesTableUrl}?offset=${midOffset}&shape_id=${shapeId}`,
      {}
    )
    const catchupEtag = catchupEtagRes.headers.get(`etag`)
    assert(catchupEtag !== null, `Response should have catchup etag header`)
    console.log({ catchupEtag })

    // Catch-up offsets should also use the same etag as they're
    // also working through the end of the current log.
    const catchupEtagValidation = await fetch(
      `${BASE_URL}/shape/${issuesTableUrl}?offset=${midOffset}&shape_id=${shapeId}`,
      {
        headers: { 'If-None-Match': catchupEtag },
      }
    )
    const catchupStatus = catchupEtagValidation.status
    expect(catchupStatus).toEqual(304)
  })
})
