import { parse } from 'cache-control-parser'
import { setTimeout as sleep } from 'node:timers/promises'
import { v4 as uuidv4 } from 'uuid'
import { describe, expect, inject, vi } from 'vitest'
import { FetchError, Shape, ShapeStream, ShapeStreamOptions } from '../src'
import { Message } from '../src/types'
import {
  isChangeMessage,
  isControlMessage,
  isUpToDateMessage,
} from '../src/helpers'
import {
  IssueRow,
  testWithIssuesTable as it,
  testWithMultitypeTable as mit,
} from './support/test-context'
import * as h from './support/test-helpers'

const BASE_URL = inject(`baseUrl`)

const fetchAndSse = [{ liveSse: false }, { liveSse: true }]

it(`sanity check`, async ({ dbClient, issuesTableSql }) => {
  const result = await dbClient.query(`SELECT * FROM ${issuesTableSql}`)

  expect(result.rows).toEqual([])
})

describe(`HTTP Sync`, () => {
  it.for(fetchAndSse)(
    `should work with empty shape/table (liveSSE=$liveSse)`,
    async ({ liveSse }, { issuesTableUrl, aborter }) => {
      // Get initial data
      const shapeData = new Map()
      const issueStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        subscribe: false,
        signal: aborter.signal,
        liveSse,
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
    }
  )

  it.for(fetchAndSse)(
    `should wait properly for updates on an empty shape/table (liveSSE=$liveSse)`,
    async ({ liveSse }, { issuesTableUrl, aborter }) => {
      const urlsRequested: URL[] = []
      const fetchWrapper = async (...args: Parameters<typeof fetch>) => {
        //console.log('fetch sse', liveSse)
        const url = new URL(args[0] instanceof Request ? args[0].url : args[0])
        //console.log("url", url)
        urlsRequested.push(url)
        const res = await fetch(...args)
        //console.log("res", res)
        return res
      }

      // Get initial data
      const shapeData = new Map()
      const issueStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        signal: aborter.signal,
        fetchClient: fetchWrapper,
        liveSse,
      })

      let upToDateMessageCount = 0

      // TODO: this test fails in SSE mode because we don't use the provided fetchWrapper
      //       SSE uses the built-in fetch.
      //       Should fix that

      await new Promise<void>((resolve, reject) => {
        issueStream.subscribe((messages) => {
          //console.log("sse", liveSse)
          //console.log("messages", messages)
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
      //console.log("urlsRequested", urlsRequested)

      if (liveSse) {
        // We expect 3 requests: 2 requests for the initial fetch and the live request (which is 1 request streaming all updates)
        expect(numRequests).toBe(3)
      } else {
        // We expect more than 2 requests: the initial fetch + 1 request per live update
        expect(numRequests).toBeGreaterThan(2)
      }

      expect(urlsRequested[0].searchParams.get(`offset`)).toBe(`-1`)
      expect(urlsRequested[0].searchParams.has(`live`)).false
      expect(
        urlsRequested[numRequests - 1].searchParams.get(`offset`)
      ).not.toBe(`-1`)
      expect(urlsRequested[numRequests - 1].searchParams.has(`live`)).true
      expect(urlsRequested[numRequests - 1].searchParams.has(`cursor`)).true

      // first request comes back immediately and is up to date, second one
      // should hang while waiting for updates
      expect(upToDateMessageCount).toBe(1)

      // data should be 0
      const values = [...shapeData.values()]
      expect(values).toHaveLength(0)
    }
  )

  it(`returns a header with the server shape handle`, async ({
    issuesTableUrl,
  }) => {
    const res = await fetch(
      `${BASE_URL}/v1/shape?table=${issuesTableUrl}&offset=-1`,
      {}
    )
    const shapeHandle = res.headers.get(`electric-handle`)
    expect(shapeHandle).to.exist
  })

  it(`returns a header with the chunk's last offset`, async ({
    issuesTableUrl,
  }) => {
    const res = await fetch(
      `${BASE_URL}/v1/shape?table=${issuesTableUrl}&offset=-1`,
      {}
    )
    const lastOffset = res.headers.get(`electric-offset`)
    expect(lastOffset).to.exist
  })

  it.for(fetchAndSse)(
    `should get initial data (liveSSE=$liveSse)`,
    async ({ liveSse }, { insertIssues, issuesTableUrl, aborter }) => {
      // Add an initial row.
      const uuid = uuidv4()
      await insertIssues({ id: uuid, title: `foo + ${uuid}` })

      // Get initial data
      const shapeData = new Map()
      const issueStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        signal: aborter.signal,
        liveSse,
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
    }
  )

  mit.for(fetchAndSse)(
    `should parse incoming data (liveSSE=$liveSse)`,
    async ({ liveSse }, { dbClient, aborter, tableSql, tableUrl }) => {
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
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: tableUrl,
        },
        signal: aborter.signal,
        liveSse,
      })
      const client = new Shape(issueStream)
      const rows = await client.rows

      expect(rows).toMatchObject([
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

      await h.waitForTransaction({
        baseUrl: BASE_URL,
        table: tableUrl,
        numChangesExpected: 2,
      })

      await vi.waitFor(async () => {
        expect(client.isUpToDate && !client.lastOffset.startsWith(`0_`)).true
        const updatedData = await client.rows
        expect(updatedData).toMatchObject([
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
      })
    }
  )

  it.for(fetchAndSse)(
    `should get initial data and then receive updates (liveSSE=$liveSse)`,
    async (
      { liveSse },
      {
        aborter,
        issuesTableUrl,
        issuesTableKey,
        updateIssue,
        insertIssues,
        waitForIssues,
      }
    ) => {
      // With initial data
      const rowId = uuidv4()
      await insertIssues({ id: rowId, title: `original insert` })
      await waitForIssues({ numChangesExpected: 1 })

      const shapeData = new Map()
      const issueStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        signal: aborter.signal,
        liveSse,
      })
      let secondRowId = ``
      await h.forEachMessage(issueStream, aborter, async (res, msg, nth) => {
        //console.log("GOT msg:", msg)
        //console.log("nth", nth)
        //console.log('isChangeMessage', isChangeMessage(msg))
        if (!isChangeMessage(msg)) return
        shapeData.set(msg.key, msg.value)

        if (nth === 0) {
          await updateIssue({ id: rowId, title: `foo1` })
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
    }
  )

  it.for(fetchAndSse)(
    `should wait for processing before advancing stream (liveSSE=$liveSse)`,
    async (
      { liveSse },
      { aborter, issuesTableUrl, insertIssues, waitForIssues }
    ) => {
      // With initial data
      await insertIssues({ id: uuidv4(), title: `original insert` })

      const fetchWrapper = vi
        .fn()
        .mockImplementation((...args: Parameters<typeof fetch>) => {
          return fetch(...args)
        })

      const shapeData = new Map()
      const issueStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        signal: aborter.signal,
        fetchClient: fetchWrapper,
        liveSse,
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

          // independent stream should be able to see this item,
          // but the stream we have is waiting
          await waitForIssues({ numChangesExpected: 1 })
          expect(fetchWrapper).toHaveBeenCalledTimes(numFetchCalls)
        } else if (nth === 1) {
          expect(fetchWrapper.mock.calls.length).greaterThan(numFetchCalls)
          res()
        }
      })
    }
  )

  it.for(fetchAndSse)(
    `multiple clients can get the same data in parallel (liveSSE=$liveSse)`,
    async ({ liveSse }, { issuesTableUrl, updateIssue, insertIssues }) => {
      const rowId = uuidv4(),
        rowId2 = uuidv4()
      await insertIssues(
        { id: rowId, title: `first original insert` },
        { id: rowId2, title: `second original insert` }
      )

      const shapeData1 = new Map()
      const aborter1 = new AbortController()
      const issueStream1 = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        signal: aborter1.signal,
        liveSse,
      })

      const shapeData2 = new Map()
      const aborter2 = new AbortController()
      const issueStream2 = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        signal: aborter2.signal,
        liveSse,
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
    }
  )

  it.for(fetchAndSse)(
    `can go offline and then catchup (liveSSE=$liveSse)`,
    async (
      { liveSse },
      { aborter, issuesTableUrl, insertIssues, waitForIssues }
    ) => {
      // initialize storage for the cases where persisted shape streams are tested
      await insertIssues(
        { title: `foo1` },
        { title: `foo2` },
        { title: `foo3` }
      )

      const streamState = await waitForIssues({ numChangesExpected: 3 })

      const numIssuesToAdd = 9
      await insertIssues(
        ...Array.from({ length: numIssuesToAdd }, (_, i) => ({
          title: `foo${i + 5}`,
        }))
      )

      // And wait until it's definitely seen
      await waitForIssues({
        shapeStreamOptions: streamState,
        numChangesExpected: numIssuesToAdd,
      })

      let catchupOpsCount = 0
      const newIssueStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        subscribe: true,
        signal: aborter.signal,
        offset: streamState.offset,
        handle: streamState.handle,
        liveSse,
      })

      await h.forEachMessage(newIssueStream, aborter, (res, msg, nth) => {
        if (isUpToDateMessage(msg)) {
          res()
        } else {
          catchupOpsCount = nth + 1
        }
      })

      expect(catchupOpsCount).toBe(9)
    }
  )

  it(`should return correct caching headers`, async ({
    issuesTableUrl,
    insertIssues,
    waitForIssues,
  }) => {
    const res = await fetch(
      `${BASE_URL}/v1/shape?table=${issuesTableUrl}&offset=-1`,
      {}
    )
    const cacheHeaders = res.headers.get(`cache-control`)
    expect(cacheHeaders, `Response should have cache-control header`).not.toBe(
      null
    )
    const directives = parse(cacheHeaders!)
    expect(directives).toEqual({
      public: true,
      'max-age': 604800,
      's-maxage': 3600,
      'stale-while-revalidate': 2629746,
    })
    const etagHeader = res.headers.get(`etag`)
    expect(etagHeader, `Response should have etag header`).not.toBe(null)

    await insertIssues(
      { title: `foo4` },
      { title: `foo5` },
      { title: `foo6` },
      { title: `foo7` },
      { title: `foo8` }
    )
    // Wait for server to get all the messages.
    await waitForIssues({
      numChangesExpected: 5,
    })

    const res2 = await fetch(
      `${BASE_URL}/v1/shape?table=${issuesTableUrl}&offset=-1`
    )
    const etag2Header = res2.headers.get(`etag`)
    expect(etag2Header, `Response should have etag header`).not.toEqual(null)
    expect(etagHeader).toEqual(etag2Header)

    // Second chunk is not yet full, so no e-tag yet
    const res3 = await fetch(
      `${BASE_URL}/v1/shape?table=${issuesTableUrl}&offset=${res2.headers.get(`electric-offset`)}&handle=${res2.headers.get(`electric-handle`)}`
    )
    const etag3Header = res3.headers.get(`etag`)
    expect(etag3Header, `Response should have etag header`).not.toEqual(null)
    expect(etagHeader).not.toEqual(etag3Header)
  })

  it(`should revalidate etags`, async ({
    issuesTableUrl,
    insertIssues,
    waitForIssues,
  }) => {
    // Start the shape
    const baseRes = await fetch(
      `${BASE_URL}/v1/shape?table=${issuesTableUrl}&offset=-1`,
      {}
    )
    const handle = baseRes.headers.get(`electric-handle`)
    // Fill it up in separate transactions
    const numTransactions = 9
    for (const i of Array.from({ length: numTransactions }, (_, i) => i + 1)) {
      await insertIssues({ title: `foo${i}` })
    }

    // And wait until it's definitely seen
    await waitForIssues({ numChangesExpected: numTransactions })

    const res = await fetch(
      `${BASE_URL}/v1/shape?table=${issuesTableUrl}&offset=0_0&handle=${handle}`,
      {}
    )
    const messages = (await res.json()) as Message[]
    expect(messages.length).toEqual(10) // 9 inserts + up-to-date
    const shapeHandle = res.headers.get(`electric-handle`)
    const shapeOffset = res.headers.get(`electric-offset`)!
    const fakeMidOffset = shapeOffset
      .split(`_`)
      .map(BigInt)
      .map((x, i) => (i === 0 ? x - BigInt(1) : x))
      .join(`_`)
    const etag = res.headers.get(`etag`)
    expect(etag, `Response should have etag header`).not.toBe(null)

    const etagValidation = await fetch(
      `${BASE_URL}/v1/shape?table=${issuesTableUrl}&offset=0_0&handle=${handle}`,
      {
        headers: { 'If-None-Match': etag! },
      }
    )

    const status = etagValidation.status
    expect(status).toEqual(304)

    // Get etag for catchup
    const catchupEtagRes = await fetch(
      `${BASE_URL}/v1/shape?table=${issuesTableUrl}&offset=${fakeMidOffset}&handle=${shapeHandle}`,
      {}
    )
    const catchupEtag = catchupEtagRes.headers.get(`etag`)
    expect(catchupEtag, `Response should have catchup etag header`).not.toBe(
      null
    )

    // Catch-up offsets should also use the same etag as they're
    // also working through the end of the current log.
    const catchupEtagValidation = await fetch(
      `${BASE_URL}/v1/shape?table=${issuesTableUrl}&offset=${fakeMidOffset}&handle=${shapeHandle}`,
      {
        headers: { 'If-None-Match': catchupEtag! },
      }
    )
    const catchupStatus = catchupEtagValidation.status
    expect(catchupStatus).toEqual(304)
  })

  it.for(fetchAndSse)(
    `should correctly use a where clause for initial sync and updates (liveSSE=$liveSse)`,
    async (
      { liveSse },
      {
        insertIssues,
        updateIssue,
        issuesTableUrl,
        issuesTableKey,
        clearShape,
        aborter,
      }
    ) => {
      // Add an initial rows
      const id1 = uuidv4()
      const id2 = uuidv4()

      await insertIssues({ id: id1, title: `foo` }, { id: id2, title: `bar` })

      // Get initial data
      const shapeData = new Map()
      const issueStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
          where: `title LIKE 'foo%'`,
        },
        signal: aborter.signal,
        liveSse,
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

      await clearShape(issuesTableUrl, { handle: issueStream.shapeHandle! })

      expect(shapeData).toEqual(
        new Map([[`${issuesTableKey}/"${id1}"`, { id: id1, title: `foo1` }]])
      )
    }
  )

  mit.for(fetchAndSse)(
    `should correctly select columns for initial sync and updates (liveSSE=$liveSse)`,
    async ({ liveSse }, { dbClient, aborter, tableSql, tableUrl }) => {
      await dbClient.query(
        `INSERT INTO ${tableSql} (txt, i2, i4, i8) VALUES ($1, $2, $3, $4)`,
        [`test1`, 1, 10, 100]
      )

      // Get initial data
      const shapeData = new Map()
      const issueStream = new ShapeStream({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: tableUrl,
          columns: [`txt`, `i2`, `i4`],
        },
        signal: aborter.signal,
        liveSse,
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
    waitForIssues,
  }) => {
    const getTitleWithSize = (byteSize: number) =>
      Array.from({ length: byteSize }, () =>
        // generate random ASCII code
        String.fromCharCode(Math.floor(32 + Math.random() * (126 - 32)))
      ).join(``)

    // adds a bunch of rows with very large titles to force chunking
    const insertDataSize = (byteSize: number) =>
      insertIssues(
        ...Array.from({ length: Math.ceil(byteSize / 1e3) }, () => ({
          id: uuidv4(),
          title: getTitleWithSize(1e3),
        }))
      )

    const responseSizes: number[] = []

    const fetchWrapper = async (...args: Parameters<typeof fetch>) => {
      const res = await fetch(...args)
      if (res.status === 200) {
        const body = (await res.clone().json()) as Message[]
        if (body.length == 1 && isControlMessage(body[0])) {
          // do not include up-to-date responses
        } else {
          const resBlob = await res.clone().blob()
          responseSizes.push(resBlob.size)
        }
      }
      return res
    }

    // check it twice to ensure chunking occurs on both initial snapshot
    // and subsequent operations
    let streamState: Partial<ShapeStreamOptions> = {}
    for (let i = 0; i < 2; i++) {
      await insertDataSize(35000)
      streamState = await waitForIssues({
        shapeStreamOptions: {
          ...streamState,
          fetchClient: fetchWrapper,
        },
      })

      // should have received at least 2 responses/chunks
      const numChunks = responseSizes.length
      expect(numChunks).greaterThanOrEqual(2)
      while (responseSizes.length > 0) {
        const responseSize = responseSizes.shift()
        const isLastResponse = responseSizes.length === 0
        if (!isLastResponse) {
          // expect chunks to be close to 10 kB +- 20%
          expect(responseSize).closeTo(10 * 1e3, 2e3)
        } else {
          // expect last response to be ~ 10 kB or less
          expect(responseSize).toBeLessThan(11 * 1e3)
        }
      }
    }
  })

  it.for(fetchAndSse)(
    `should handle invalid requests by terminating stream (liveSSE=$liveSse)`,
    async ({ liveSse }, { expect, issuesTableUrl, aborter, waitForIssues }) => {
      const streamState = await waitForIssues({ numChangesExpected: 0 })

      let error: Error
      const invalidIssueStream = new ShapeStream<IssueRow>({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
          where: `1 x 1`, // invalid SQL
        },
        signal: aborter.signal,
        handle: streamState.handle,
        onError: (err) => {
          error = err
        },
        liveSse,
      })

      const errorSubscriberPromise = new Promise((_, reject) =>
        invalidIssueStream.subscribe(() => {}, reject)
      )

      await expect(errorSubscriberPromise).rejects.toThrow(FetchError)
      expect(invalidIssueStream.error).instanceOf(FetchError)
      expect((invalidIssueStream.error! as FetchError).status).toBe(400)
      expect(invalidIssueStream.isConnected()).false
      expect((error! as FetchError).json).toStrictEqual({
        message: `Invalid request`,
        errors: {
          where: [`At location 17: syntax error at or near "x"`],
        },
      })
    }
  )

  it.for(fetchAndSse)(
    `should handle invalid requests by terminating stream (liveSSE=$liveSse)`,
    async ({ liveSse }, { expect, issuesTableUrl, aborter }) => {
      let error: Error
      const invalidIssueStream = new ShapeStream<IssueRow>({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
          where: `1=1`,
        },
        signal: aborter.signal,
        // handle: streamState.handle,
        onError: (err) => {
          error = err
        },
        fetchClient: async (...args) => {
          const res = await fetch(...args)
          await res.text()
          return res
        },
        liveSse,
      })

      const errorSubscriberPromise = new Promise((_, reject) =>
        invalidIssueStream.subscribe(() => {}, reject)
      )

      await expect(errorSubscriberPromise).rejects.toThrow(FetchError)
      expect(invalidIssueStream.error).instanceOf(FetchError)
      expect(invalidIssueStream.isConnected()).false
      expect(error!.message).contains(
        `Body is unusable: Body has already been read`
      )
    }
  )

  it.for(fetchAndSse)(
    `should detect shape deprecation and restart syncing (liveSSE=$liveSse)`,
    async (
      { liveSse },
      { expect, insertIssues, issuesTableUrl, aborter, clearIssuesShape }
    ) => {
      // With initial data
      const rowId = uuidv4(),
        rowId2 = uuidv4()
      await insertIssues({ id: rowId, title: `foo1` })

      const statusCodesReceived: number[] = []
      let numRequests = 0

      const fetchWrapper = async (...args: Parameters<typeof fetch>) => {
        // before any subsequent requests after the initial one, ensure
        // that the existing shape is deleted and some more data is inserted
        if (numRequests === 2) {
          await insertIssues({ id: rowId2, title: `foo2` })
          await clearIssuesShape(issueStream.shapeHandle)
        }

        numRequests++
        const response = await fetch(...args)

        if (response.status < 500) {
          statusCodesReceived.push(response.status)
        }

        return response
      }

      const issueStream = new ShapeStream<IssueRow>({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        subscribe: true,
        signal: aborter.signal,
        fetchClient: fetchWrapper,
        liveSse,
      })

      expect.assertions(12)

      let originalShapeHandle: string | undefined
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
            expect(statusCodesReceived.length).greaterThanOrEqual(5)
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
            expect(issueStream.shapeHandle).to.exist
            originalShapeHandle = issueStream.shapeHandle
            break
          case 1:
          case 2:
            // Second snapshot queries PG without `ORDER BY`, so check that it's generally correct.
            // We're checking that both messages arrive by using `expect.assertions(N)` above.

            if (msg.value.id == rowId) {
              // message is the initial row again as it is a new shape
              // with different shape handle
              expect(msg.value).toEqual({
                id: rowId,
                title: `foo1`,
                priority: 10,
              })
              expect(issueStream.shapeHandle).not.toBe(originalShapeHandle)
            } else {
              // should get the second row as well with the new shape handle
              expect(msg.value).toEqual({
                id: rowId2,
                title: `foo2`,
                priority: 10,
              })
              expect(issueStream.shapeHandle).not.toBe(originalShapeHandle)
            }
            break
          default:
            expect.unreachable(`Received more messages than expected`)
        }
      })
    }
  )

  it.for(fetchAndSse)(
    `should continue from same offset when recovering from error with onError retry (liveSSE=$liveSse)`,
    async ({ liveSse }, { expect, insertIssues, issuesTableUrl, aborter }) => {
      // Insert initial data
      const rowId = uuidv4()
      await insertIssues({ id: rowId, title: `test` })

      let requestCount = 0
      let shouldFail = true
      let offsetBeforeError: string | undefined
      let offsetAfterError: string | undefined

      const fetchWrapper = async (...args: Parameters<typeof fetch>) => {
        requestCount++
        const url = args[0] as string

        // Capture offset from URL
        const urlObj = new URL(url)
        const offset = urlObj.searchParams.get(`offset`)

        // Fail the second request (first live request after initial sync)
        if (requestCount === 2 && shouldFail) {
          shouldFail = false
          offsetBeforeError = offset ?? undefined
          // Simulate a 401 error
          return new Response(JSON.stringify({ error: `Unauthorized` }), {
            status: 401,
            headers: {
              'content-type': `application/json`,
            },
          })
        }

        // Capture offset of retry request
        if (requestCount === 3) {
          offsetAfterError = offset ?? undefined
        }

        return fetch(...args)
      }

      const issueStream = new ShapeStream<IssueRow>({
        url: `${BASE_URL}/v1/shape`,
        params: {
          table: issuesTableUrl,
        },
        subscribe: true,
        signal: aborter.signal,
        fetchClient: fetchWrapper,
        liveSse,
        onError: async (error) => {
          if (error instanceof FetchError && error.status === 401) {
            // Simulate refreshing auth token
            return { headers: { Authorization: `Bearer new-token` } }
          }
          throw error
        },
      })

      const shape = new Shape(issueStream)

      let insertCount = 0
      const seenKeys = new Set<string>()

      const unsubscribe = issueStream.subscribe((messages) => {
        for (const msg of messages) {
          if (isChangeMessage(msg) && msg.headers.operation === `insert`) {
            // Track if we see duplicate inserts for the same key
            if (seenKeys.has(msg.key)) {
              throw new Error(
                `Duplicate insert for key ${msg.key} - this should not happen!`
              )
            }
            seenKeys.add(msg.key)
            insertCount++
          }
        }
      })

      // Wait for initial sync and error recovery
      await shape.rows
      await sleep(500) // Give it time to recover and re-sync

      unsubscribe()
      aborter.abort()

      // Verify that:
      // 1. We continued from the same offset (not reset to -1)
      expect(offsetBeforeError).toBeDefined()
      expect(offsetAfterError).toBeDefined()
      expect(offsetAfterError).toBe(offsetBeforeError)
      expect(offsetAfterError).not.toBe(`-1`)

      // 2. We only saw each insert operation once (no duplicates)
      expect(insertCount).toBe(1)

      // 3. The shape has the correct data
      const rows = shape.currentRows
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe(rowId)
    }
  )
})
