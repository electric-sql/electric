import { parse } from 'cache-control-parser'
import { setTimeout as sleep } from 'node:timers/promises'
import { v4 as uuidv4 } from 'uuid'
import { assert, describe, expect, inject, vi } from 'vitest'
import { FetchError, Shape, ShapeStream } from '../src'
import { Message, Offset } from '../src/types'
import { isChangeMessage, isUpToDateMessage } from '../src/helpers'
import {
  IssueRow,
  testWithIssuesTable as it,
  testWithMultitypeTable as mit,
} from './support/test-context'
import * as h from './support/test-helpers'

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
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      subscribe: false,
      signal: aborter.signal,
    })

    await new Promise<void>((resolve, reject) => {
      issueStream.subscribe((messages) => {
        messages.forEach((message) => {
          if (isChangeMessage(message)) {
            shapeData.set(message.key, message.value)
          }
          if (isUpToDateMessage(message)) {
            aborter.abort()
            return resolve()
          }
        })
      }, reject)
    })
    const values = [...shapeData.values()]

    expect(values).toHaveLength(0)
  })

  it(`should wait properly for updates on an empty shape/table`, async ({
    issuesTableUrl,
    aborter,
  }) => {
    const urlsRequested: URL[] = []
    const fetchWrapper = (...args: Parameters<typeof fetch>) => {
      const url = new URL(args[0])
      urlsRequested.push(url)
      return fetch(...args)
    }

    // Get initial data
    const shapeData = new Map()
    const issueStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    let upToDateMessageCount = 0

    await new Promise<void>((resolve, reject) => {
      issueStream.subscribe((messages) => {
        messages.forEach((message) => {
          if (isChangeMessage(message)) {
            shapeData.set(message.key, message.value)
          }
          if (isUpToDateMessage(message)) {
            upToDateMessageCount += 1
          }
        })
      }, reject)

      // count updates received over 1 second - proper long polling
      // should wait for far longer than this time period
      setTimeout(() => {
        aborter.abort()
        resolve()
      }, 1000)
    })

    // first request was -1, last requests should be live ones
    const numRequests = urlsRequested.length
    expect(numRequests).toBeGreaterThan(2)
    expect(urlsRequested[0].searchParams.get(`offset`)).toBe(`-1`)
    expect(urlsRequested[0].searchParams.has(`live`)).false
    expect(urlsRequested[numRequests - 1].searchParams.get(`offset`)).not.toBe(
      `-1`
    )
    expect(urlsRequested[numRequests - 1].searchParams.has(`live`)).true
    expect(urlsRequested[numRequests - 1].searchParams.has(`cursor`)).true

    // first request comes back immediately and is up to date, second one
    // should hang while waiting for updates
    expect(upToDateMessageCount).toBe(1)

    // data should be 0
    const values = [...shapeData.values()]
    expect(values).toHaveLength(0)
  })

  it(`returns a header with the server shape id`, async ({
    issuesTableUrl,
  }) => {
    const res = await fetch(
      `${BASE_URL}/v1/shape/${issuesTableUrl}?offset=-1`,
      {}
    )
    const shapeId = res.headers.get(`electric-shape-id`)
    expect(shapeId).to.exist
  })

  it(`returns a header with the chunk's last offset`, async ({
    issuesTableUrl,
  }) => {
    const res = await fetch(
      `${BASE_URL}/v1/shape/${issuesTableUrl}?offset=-1`,
      {}
    )
    const lastOffset = res.headers.get(`electric-chunk-last-offset`)
    expect(lastOffset).to.exist
  })

  it(`should get initial data`, async ({
    insertIssues,
    issuesTableUrl,
    aborter,
  }) => {
    // Add an initial row.
    const uuid = uuidv4()
    await insertIssues({ id: uuid, title: `foo + ${uuid}` })

    // Get initial data
    const shapeData = new Map()
    const issueStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      signal: aborter.signal,
    })

    await new Promise<void>((resolve) => {
      issueStream.subscribe((messages) => {
        messages.forEach((message) => {
          if (isChangeMessage(message)) {
            shapeData.set(message.key, message.value)
          }
          if (isUpToDateMessage(message)) {
            aborter.abort()
            return resolve()
          }
        })
      })
    })
    const values = [...shapeData.values()]

    expect(values).toMatchObject([{ title: `foo + ${uuid}` }])
  })

  mit(
    `should parse incoming data`,
    async ({ dbClient, aborter, tableSql, tableUrl }) => {
      // Create a table with data we want to be parsed
      await dbClient.query(
        `
      INSERT INTO ${tableSql} (txt, i2, i4, i8, f8, b, json, jsonb, ints, ints2, int4s, bools, moods, moods2, complexes, posints, jsons, txts, value, doubles)
      VALUES (
        'test',
        1,
        2147483647,
        9223372036854775807,
        4.5,
        TRUE,
        '{"foo": "bar"}',
        '{"foo": "bar"}',
        '{1,2,3}',
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11
      )
    `,
        [
          [
            [1, 2, 3],
            [4, 5, 6],
          ],
          [1, 2, 3],
          [true, false, true],
          [`sad`, `ok`, `happy`],
          [
            [`sad`, `ok`],
            [`ok`, `happy`],
          ],
          [`(1.1, 2.2)`, `(3.3, 4.4)`],
          [5, 9, 2],
          [{ foo: `bar` }, { bar: `baz` }],
          [`foo`, `bar`, `baz`],
          { a: 5, b: [{ c: `foo` }] },
          [Infinity, -Infinity, NaN],
        ]
      )

      // Now fetch the data from the HTTP endpoint
      const issueStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape/${tableUrl}`,
        signal: aborter.signal,
      })
      const client = new Shape(issueStream)
      const data = await client.value

      expect([...data.values()]).toMatchObject([
        {
          txt: `test`,
          i2: 1,
          i4: 2147483647,
          i8: BigInt(`9223372036854775807`),
          f8: 4.5,
          b: true,
          json: { foo: `bar` },
          jsonb: { foo: `bar` },
          ints: [BigInt(1), BigInt(2), BigInt(3)],
          ints2: [
            [BigInt(1), BigInt(2), BigInt(3)],
            [BigInt(4), BigInt(5), BigInt(6)],
          ],
          int4s: [1, 2, 3],
          bools: [true, false, true],
          moods: [`sad`, `ok`, `happy`],
          moods2: [
            [`sad`, `ok`],
            [`ok`, `happy`],
          ],
          // It does not parse composite types and domain types
          complexes: [`(1.1,2.2)`, `(3.3,4.4)`],
          posints: [`5`, `9`, `2`],
          jsons: [{ foo: `bar` }, { bar: `baz` }],
          txts: [`foo`, `bar`, `baz`],
          value: { a: 5, b: [{ c: `foo` }] },
          doubles: [Infinity, -Infinity, NaN],
        },
      ])

      // Now update the data
      await dbClient.query(
        `
      UPDATE ${tableSql}
      SET
        txt = 'changed',
        i4 = 20,
        i8 = 30,
        f8 = 40.5,
        b = FALSE,
        json = '{"bar": "foo"}',
        jsonb = '{"bar": "foo"}',
        ints = '{4,5,6}',
        ints2 = '{{4,5,6},{7,8,9}}',
        int4s = '{4,5,6}',
        bools = $1,
        moods = '{sad,happy}',
        moods2 = '{{sad,happy},{happy,ok}}',
        complexes = $2,
        posints = '{6,10,3}',
        jsons = $3,
        txts = $4,
        value = $5,
        doubles = $6
      WHERE i2 = 1
    `,
        [
          [false, true, false],
          [`(2.2,3.3)`, `(4.4,5.5)`],
          [{}],
          [`new`, `values`],
          { a: 6 },
          [Infinity, NaN, -Infinity],
        ]
      )

      await vi.waitFor(async () => {
        const res = await fetch(`${BASE_URL}/v1/shape/${tableUrl}?offset=-1`)
        const body = (await res.json()) as Message[]
        expect(body.length).greaterThan(1)
      })
      const updatedData = client.valueSync

      expect([...updatedData.values()]).toMatchObject([
        {
          txt: `changed`,
          i2: 1,
          i4: 20,
          i8: BigInt(30),
          f8: 40.5,
          b: false,
          json: { bar: `foo` },
          jsonb: { bar: `foo` },
          ints: [BigInt(4), BigInt(5), BigInt(6)],
          ints2: [
            [BigInt(4), BigInt(5), BigInt(6)],
            [BigInt(7), BigInt(8), BigInt(9)],
          ],
          int4s: [4, 5, 6],
          bools: [false, true, false],
          moods: [`sad`, `happy`],
          moods2: [
            [`sad`, `happy`],
            [`happy`, `ok`],
          ],
          complexes: [`(2.2,3.3)`, `(4.4,5.5)`],
          posints: [`6`, `10`, `3`],
          jsons: [{}],
          txts: [`new`, `values`],
          value: { a: 6 },
          doubles: [Infinity, NaN, -Infinity],
        },
      ])
    }
  )

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
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      signal: aborter.signal,
    })
    let secondRowId = ``
    await h.forEachMessage(issueStream, aborter, async (res, msg, nth) => {
      if (!isChangeMessage(msg)) return
      shapeData.set(msg.key, msg.value)

      if (nth === 0) {
        updateIssue({ id: rowId, title: `foo1` })
      } else if (nth === 1) {
        ;[secondRowId] = await insertIssues({ title: `foo2` })
      } else if (nth === 2) {
        res()
      }
    })

    // Only initial insert has the full row, the update contains only PK & changed columns.
    // This test doesn't merge in updates, so we don't have `priority` on the row.
    expect(shapeData).toEqual(
      new Map([
        [`${issuesTableKey}/"${rowId}"`, { id: rowId, title: `foo1` }],
        [
          `${issuesTableKey}/"${secondRowId}"`,
          { id: secondRowId, title: `foo2`, priority: 10 },
        ],
      ])
    )
  })

  it(`should wait for processing before advancing stream`, async ({
    aborter,
    issuesTableUrl,

    insertIssues,
  }) => {
    // With initial data
    await insertIssues({ id: uuidv4(), title: `original insert` })

    const fetchWrapper = vi
      .fn()
      .mockImplementation((...args: Parameters<typeof fetch>) => {
        return fetch(...args)
      })

    const shapeData = new Map()
    const issueStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    let numFetchCalls = 0

    await h.forEachMessage(issueStream, aborter, async (res, msg, nth) => {
      if (!isChangeMessage(msg)) return
      shapeData.set(msg.key, msg.value)

      if (nth === 0) {
        await sleep(100)
        numFetchCalls = fetchWrapper.mock.calls.length

        // ensure fetch has not been called again while
        // waiting for processing
        await insertIssues({ title: `foo1` })
        await sleep(100)
        expect(fetchWrapper).toHaveBeenCalledTimes(numFetchCalls)
      } else if (nth === 1) {
        expect(fetchWrapper.mock.calls.length).greaterThan(numFetchCalls)
        res()
      }
    })
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
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      signal: aborter1.signal,
    })

    const shapeData2 = new Map()
    const aborter2 = new AbortController()
    const issueStream2 = new ShapeStream({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      signal: aborter2.signal,
    })

    const p1 = h.forEachMessage(issueStream1, aborter1, (res, msg, nth) => {
      if (!isChangeMessage(msg)) return
      shapeData1.set(msg.key, msg.value)

      if (nth === 1) {
        setTimeout(() => updateIssue({ id: rowId, title: `foo3` }), 50)
      } else if (nth === 2) {
        return res()
      }
    })

    const p2 = h.forEachMessage(issueStream2, aborter2, (res, msg, nth) => {
      if (!isChangeMessage(msg)) return
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
    // initialize storage for the cases where persisted shape streams are tested
    await insertIssues({ title: `foo1` }, { title: `foo2` }, { title: `foo3` })
    await sleep(50)

    let lastOffset: Offset = `-1`
    const issueStream = new ShapeStream<IssueRow>({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      signal: aborter.signal,
      subscribe: false,
    })

    await h.forEachMessage(issueStream, aborter, (res, msg) => {
      if (`offset` in msg) {
        expect(msg.offset).to.not.eq(`0_`)
        lastOffset = msg.offset
      } else if (isUpToDateMessage(msg)) {
        res()
      }
    })

    await insertIssues(
      ...Array.from({ length: 9 }, (_, i) => ({ title: `foo${i + 5}` }))
    )

    // And wait until it's definitely seen
    await vi.waitFor(async () => {
      const res = await fetch(
        `${BASE_URL}/v1/shape/${issuesTableUrl}?offset=-1`
      )
      const body = (await res.json()) as Message[]
      expect(body).toHaveLength(12)
    })

    let catchupOpsCount = 0
    const newAborter = new AbortController()
    const newIssueStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      subscribe: false,
      signal: newAborter.signal,
      offset: lastOffset,
      shapeId: issueStream.shapeId,
    })

    await h.forEachMessage(newIssueStream, newAborter, (res, msg, nth) => {
      if (isUpToDateMessage(msg)) {
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
    const res = await fetch(
      `${BASE_URL}/v1/shape/${issuesTableUrl}?offset=-1`,
      {}
    )
    const cacheHeaders = res.headers.get(`cache-control`)
    assert(cacheHeaders !== null, `Response should have cache-control header`)
    const directives = parse(cacheHeaders)
    expect(directives).toEqual({
      public: true,
      'max-age': 604800,
      's-maxage': 3600,
      'stale-while-revalidate': 2629746,
    })
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
      `${BASE_URL}/v1/shape/${issuesTableUrl}?offset=-1`,
      {}
    )
    const etag2Header = res2.headers.get(`etag`)
    expect(etag2Header !== null, `Response should have etag header`)
    expect(etagHeader).not.toEqual(etag2Header)
  })

  it(`should revalidate etags`, async ({ issuesTableUrl, insertIssues }) => {
    // Start the shape
    await fetch(`${BASE_URL}/v1/shape/${issuesTableUrl}?offset=-1`, {})
    // Fill it up in separate transactions
    for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      await insertIssues({ title: `foo${i}` })
    }
    // Then wait for them to flow through the system
    await sleep(100)

    const res = await fetch(
      `${BASE_URL}/v1/shape/${issuesTableUrl}?offset=-1`,
      {}
    )
    const messages = (await res.json()) as Message[]
    expect(messages.length).toEqual(9) // 9 inserts
    const midMessage = messages.slice(-6)[0]
    assert(`offset` in midMessage)
    const midOffset = midMessage.offset
    const shapeId = res.headers.get(`electric-shape-id`)
    const etag = res.headers.get(`etag`)
    assert(etag !== null, `Response should have etag header`)

    const etagValidation = await fetch(
      `${BASE_URL}/v1/shape/${issuesTableUrl}?offset=-1`,
      {
        headers: { 'If-None-Match': etag },
      }
    )

    const status = etagValidation.status
    expect(status).toEqual(304)

    // Get etag for catchup
    const catchupEtagRes = await fetch(
      `${BASE_URL}/v1/shape/${issuesTableUrl}?offset=${midOffset}&shape_id=${shapeId}`,
      {}
    )
    const catchupEtag = catchupEtagRes.headers.get(`etag`)
    assert(catchupEtag !== null, `Response should have catchup etag header`)

    // Catch-up offsets should also use the same etag as they're
    // also working through the end of the current log.
    const catchupEtagValidation = await fetch(
      `${BASE_URL}/v1/shape/${issuesTableUrl}?offset=${midOffset}&shape_id=${shapeId}`,
      {
        headers: { 'If-None-Match': catchupEtag },
      }
    )
    const catchupStatus = catchupEtagValidation.status
    expect(catchupStatus).toEqual(304)
  })

  it(`should correctly use a where clause for initial sync and updates`, async ({
    insertIssues,
    updateIssue,
    issuesTableUrl,
    issuesTableKey,
    clearShape,
    aborter,
  }) => {
    // Add an initial rows
    const id1 = uuidv4()
    const id2 = uuidv4()

    await insertIssues({ id: id1, title: `foo` }, { id: id2, title: `bar` })

    // Get initial data
    const shapeData = new Map()
    const issueStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      where: `title LIKE 'foo%'`,
      subscribe: true,
      signal: aborter.signal,
    })

    await h.forEachMessage(issueStream, aborter, async (res, msg, nth) => {
      if (!isChangeMessage(msg)) return
      shapeData.set(msg.key, msg.value)

      if (nth === 0) {
        updateIssue({ id: id1, title: `foo1` })
        updateIssue({ id: id2, title: `bar1` })
      } else if (nth === 1) {
        res()
      }
    })

    await clearShape(issuesTableUrl, issueStream.shapeId!)

    expect(shapeData).toEqual(
      new Map([[`${issuesTableKey}/"${id1}"`, { id: id1, title: `foo1` }]])
    )
  })

  mit(
    `should correctly select columns for initial sync and updates`,
    async ({ dbClient, aborter, tableSql, tableUrl }) => {
      await dbClient.query(
        `INSERT INTO ${tableSql} (txt, i2, i4, i8) VALUES ($1, $2, $3, $4)`,
        [`test1`, 1, 10, 100]
      )

      // Get initial data
      const shapeData = new Map()
      const issueStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape/${tableUrl}`,
        columns: [`txt`, `i2`, `i4`],
        signal: aborter.signal,
      })
      await h.forEachMessage(issueStream, aborter, async (res, msg, nth) => {
        if (!isChangeMessage(msg)) return
        shapeData.set(msg.key, msg.value)

        if (nth === 0) {
          expect(msg.value).toStrictEqual({
            txt: `test1`,
            i2: 1,
            i4: 10,
          })
          await dbClient.query(
            `UPDATE ${tableSql} SET txt = $1, i4 = $2, i8 = $3 WHERE i2 = $4`,
            [`test2`, 20, 200, 1]
          )
        } else if (nth === 1) {
          res()
        }
      })

      expect([...shapeData.values()]).toStrictEqual([
        {
          txt: `test2`,
          i2: 1,
          i4: 20,
        },
      ])
    }
  )

  it(`should chunk a large log with reasonably sized chunks`, async ({
    insertIssues,
    issuesTableUrl,
    aborter,
  }) => {
    // Add an initial row
    await insertIssues({ id: uuidv4(), title: `foo` })

    // Get initial data
    let lastOffset: Offset = `-1`
    const issueStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      subscribe: true,
      signal: aborter.signal,
    })

    await h.forEachMessage(issueStream, aborter, (res, msg) => {
      if (`offset` in msg) {
        lastOffset = msg.offset
      }
      if (isUpToDateMessage(msg)) {
        res()
        aborter.abort()
      }
    })

    const getTitleWithSize = (byteSize: number) =>
      Array.from({ length: byteSize }, () =>
        // generate random ASCII code
        String.fromCharCode(Math.floor(32 + Math.random() * (126 - 32)))
      ).join(``)

    // add a bunch of rows with very large titles to force chunking
    await insertIssues(
      ...Array.from({ length: 35 }, () => ({
        id: uuidv4(),
        title: getTitleWithSize(1e3),
      }))
    )

    // And wait until it's definitely seen
    await vi.waitFor(async () => {
      const res = await fetch(
        `${BASE_URL}/v1/shape/${issuesTableUrl}?offset=-1`
      )
      const body = (await res.json()) as Message[]
      expect(body.length).greaterThan(2)
    })

    const responseSizes: number[] = []

    const fetchWrapper = async (...args: Parameters<typeof fetch>) => {
      const res = await fetch(...args)
      if (res.status === 200) {
        const resBlob = await res.clone().blob()
        responseSizes.push(resBlob.size)
      }
      return res
    }

    const newAborter = new AbortController()
    const newIssueStream = new ShapeStream({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      subscribe: false,
      signal: newAborter.signal,
      offset: lastOffset,
      shapeId: issueStream.shapeId,
      fetchClient: fetchWrapper,
    })

    await h.forEachMessage(newIssueStream, aborter, (res, msg) => {
      if (isUpToDateMessage(msg)) {
        res()
      }
    })

    // should have received at least 2 responses/chunks
    const numChunks = responseSizes.length
    expect(numChunks).greaterThanOrEqual(2)
    for (let i = 0; i < numChunks; i++) {
      const responseSize = responseSizes[i]
      const isLastResponse = i === numChunks - 1
      if (!isLastResponse) {
        // expect chunks to be close to 10 kB +- some kB
        expect(responseSize).closeTo(10 * 1e3, 1e3)
      } else {
        // expect last response to be ~ 10 kB or less
        expect(responseSize).toBeLessThan(11 * 1e3)
      }
    }
  })

  it(`should handle invalid requests by terminating stream`, async ({
    expect,
    issuesTableUrl,
    aborter,
  }) => {
    const issueStream = new ShapeStream<IssueRow>({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      subscribe: true,
      signal: aborter.signal,
    })

    await h.forEachMessage(issueStream, aborter, (res, msg) => {
      if (isUpToDateMessage(msg)) res()
    })

    const invalidIssueStream = new ShapeStream<IssueRow>({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      subscribe: true,
      shapeId: issueStream.shapeId,
      where: `1=1`,
    })

    const errorSubscriberPromise = new Promise((_, reject) =>
      invalidIssueStream.subscribe(() => {}, reject)
    )
    const errorUpToDateSubscriberPromise = new Promise((_, reject) =>
      invalidIssueStream.subscribeOnceToUpToDate(() => {}, reject)
    )

    await expect(errorSubscriberPromise).rejects.toThrow(FetchError)
    await expect(errorUpToDateSubscriberPromise).rejects.toThrow(FetchError)
    expect(invalidIssueStream.error).instanceOf(FetchError)
    expect((invalidIssueStream.error! as FetchError).status).toBe(400)
    expect(invalidIssueStream.isConnected()).false
  })

  it(`should detect shape deprecation and restart syncing`, async ({
    expect,
    insertIssues,
    issuesTableUrl,
    aborter,
    clearIssuesShape,
  }) => {
    // With initial data
    const rowId = uuidv4()
    const secondRowId = uuidv4()
    await insertIssues({ id: rowId, title: `foo1` })

    const statusCodesReceived: number[] = []
    let numRequests = 0

    const fetchWrapper = async (...args: Parameters<typeof fetch>) => {
      // before any subsequent requests after the initial one, ensure
      // that the existing shape is deleted and some more data is inserted
      if (numRequests === 2) {
        await insertIssues({ id: secondRowId, title: `foo2` })
        await clearIssuesShape(issueStream.shapeId)
      }

      numRequests++
      const response = await fetch(...args)

      if (response.status < 500) {
        statusCodesReceived.push(response.status)
      }

      return response
    }

    const issueStream = new ShapeStream<IssueRow>({
      url: `${BASE_URL}/v1/shape/${issuesTableUrl}`,
      subscribe: true,
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    expect.assertions(12)

    let originalShapeId: string | undefined
    let upToDateReachedCount = 0
    await h.forEachMessage(issueStream, aborter, async (res, msg, nth) => {
      // shapeData.set(msg.key, msg.value)
      if (isUpToDateMessage(msg)) {
        upToDateReachedCount++
        if (upToDateReachedCount === 1) {
          // upon reaching up to date initially, we have one
          // response with the initial data
          expect(statusCodesReceived).toHaveLength(2)
          expect(statusCodesReceived[0]).toBe(200)
          expect(statusCodesReceived[1]).toBe(200)
        } else if (upToDateReachedCount === 2) {
          // the next up to date message should have had
          // a 409 interleaved before it that instructed the
          // client to go and fetch data from scratch
          expect(statusCodesReceived).toHaveLength(5)
          expect(statusCodesReceived[2]).toBe(409)
          expect(statusCodesReceived[3]).toBe(200)
          return res()
        }
        return
      }

      if (!isChangeMessage(msg)) return

      switch (nth) {
        case 0:
          // first message is the initial row
          expect(msg.value).toEqual({
            id: rowId,
            title: `foo1`,
            priority: 10,
          })
          expect(issueStream.shapeId).to.exist
          originalShapeId = issueStream.shapeId
          break
        case 1:
        case 2:
          // Second snapshot queries PG without `ORDER BY`, so check that it's generally correct.
          // We're checking that both messages arrive by using `expect.assertions(N)` above.

          if (msg.value.id == rowId) {
            // message is the initial row again as it is a new shape
            // with different shape id
            expect(msg.value).toEqual({
              id: rowId,
              title: `foo1`,
              priority: 10,
            })
            expect(issueStream.shapeId).not.toBe(originalShapeId)
          } else {
            // should get the second row as well with the new shape ID
            expect(msg.value).toEqual({
              id: secondRowId,
              title: `foo2`,
              priority: 10,
            })
            expect(issueStream.shapeId).not.toBe(originalShapeId)
          }
          break
        default:
          expect.unreachable(`Received more messages than expected`)
      }
    })
  })
})
