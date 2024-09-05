import { beforeEach, describe, expect, inject, vi } from 'vitest'
import { setTimeout as sleep } from 'node:timers/promises'
import { v4 as uuidv4 } from 'uuid'
import { testWithIssuesTable as it } from './support/test-context'
import {
  isChangeMessage,
  isControlMessage,
  Message,
  Offset,
  PromiseOr,
  Row,
} from '../src'
import { PersistedShapeStream, ShapeStreamStorage } from '../src/persist'
import { InMemoryStorage } from './persisters/in-memory'
import { InMemoryAsyncStorage } from './persisters/in-memory-async'

const isUpToDateMessage = <T extends Row>(msg: Message<T>) =>
  isControlMessage(msg) && msg.headers.control === `up-to-date`

const BASE_URL = inject(`baseUrl`)

function flushDbChanges(): Promise<void> {
  return sleep(100)
}

testPersistence(`with synchronous storage`, () => new InMemoryStorage())
testPersistence(`with asynchronous storage`, () => new InMemoryAsyncStorage())

function testPersistence(
  testSuiteTitle: string,
  createStorage: () => PromiseOr<ShapeStreamStorage>
) {
  describe(`PersistedShapeStream ${testSuiteTitle}`, () => {
    let fetchSpy = vi.spyOn(global, `fetch`)
    let storage: ShapeStreamStorage

    beforeEach(async () => {
      vi.restoreAllMocks()
      storage = await createStorage()
      fetchSpy = vi.spyOn(global, `fetch`)
    })

    it(`should store initial data`, async ({
      insertIssues,
      issuesTableUrl,
      aborter,
    }) => {
      // Add an initial row.
      const uuid = uuidv4()
      await insertIssues({ id: uuid, title: `foo + ${uuid}` })

      const url = `${BASE_URL}/v1/shape/${issuesTableUrl}`

      // Get initial data
      const issueStream = new PersistedShapeStream({
        url,
        signal: aborter.signal,
        storage,
        subscribe: false,
      })

      let lastOffset: Offset | undefined

      await new Promise<void>((resolve) => {
        issueStream.subscribe((messages) => {
          messages.forEach((message) => {
            if (isChangeMessage(message)) {
              lastOffset = message.offset
            }
            if (isUpToDateMessage(message)) {
              aborter.abort()
              return resolve()
            }
          })
        })
      })

      const shapeId = issueStream.shapeId

      // expect initial request
      expect(shapeId).toBeTypeOf(`string`)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(fetchSpy).toHaveBeenCalledWith(
        encodeURI(`${url}?offset=-1`),
        expect.any(Object)
      )

      await issueStream.flush()

      // clearing spies and starting new stream with the same
      // storage should trigger a request for offset 0_0
      fetchSpy.mockClear()
      const secondAborter = new AbortController()
      const restoredIssueStream = new PersistedShapeStream({
        url: url,
        signal: secondAborter.signal,
        storage,
        subscribe: false,
      })

      await new Promise<void>((resolve) => {
        restoredIssueStream.subscribe((messages) => {
          messages.forEach((message) => {
            if (isUpToDateMessage(message)) {
              secondAborter.abort()
              return resolve()
            }
          })
        })
      })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(fetchSpy).toHaveBeenCalledWith(
        encodeURI(`${url}?offset=${lastOffset}&shape_id=${shapeId}`),
        expect.any(Object)
      )
    })

    it(`should compact operations and restore as inserts`, async ({
      insertIssues,
      updateIssue,
      deleteIssue,
      issuesTableUrl,
      aborter,
    }) => {
      const url = `${BASE_URL}/v1/shape/${issuesTableUrl}`

      // Add initial rows
      const rowId = uuidv4(),
        rowId2 = uuidv4(),
        rowId3 = uuidv4()
      await insertIssues(
        { id: rowId, title: `first original insert` },
        { id: rowId2, title: `second original insert` }
      )

      // Get initial data
      const issueStream = new PersistedShapeStream({
        url,
        signal: aborter.signal,
        storage,
        subscribe: false,
      })

      await new Promise<void>((resolve) => {
        issueStream.subscribe((messages) => {
          messages.forEach((message) => {
            if (isUpToDateMessage(message)) {
              aborter.abort()
              return resolve()
            }
          })
        })
      })
      // expect initial request
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(fetchSpy).toHaveBeenCalledWith(
        encodeURI(`${url}?offset=-1`),
        expect.any(Object)
      )

      await Promise.all([
        updateIssue({ id: rowId, title: `first updated insert` }),
        deleteIssue({ id: rowId2, title: `second original insert` }),
        insertIssues({ id: rowId3, title: `third original insert` }),
      ])
      await Promise.all([flushDbChanges(), issueStream.flush()])

      // filling stream with new data
      const secondAborter = new AbortController()
      let restoredIssueStream = new PersistedShapeStream({
        url: url,
        signal: secondAborter.signal,
        storage,
        subscribe: false,
      })

      let opCount = 0
      await new Promise<void>((resolve) => {
        restoredIssueStream.subscribe((messages) => {
          messages.forEach((message) => {
            if (isChangeMessage(message)) {
              opCount++
            }
            if (isUpToDateMessage(message)) {
              secondAborter.abort()
              return resolve()
            }
          })
        })
      })

      // should have the 2 original inserts, and then 3 update/delete/inerts
      expect(opCount).toBe(2 + 3)

      await restoredIssueStream.flush()

      // clearing spies and starting new stream, should have as many updates
      fetchSpy.mockClear()
      const thirdAborter = new AbortController()
      restoredIssueStream = new PersistedShapeStream({
        url: url,
        signal: thirdAborter.signal,
        storage,
        subscribe: false,
      })

      opCount = 0
      await new Promise<void>((resolve) => {
        restoredIssueStream.subscribe((messages) => {
          messages.forEach((message) => {
            if (isChangeMessage(message)) {
              expect(message.headers.operation).toBe(`insert`)
              opCount++
            }
            if (isUpToDateMessage(message)) {
              thirdAborter.abort()
              return resolve()
            }
          })
        })
      })

      // should have compacted everything to 2 inserts
      expect(opCount).toBe(2)
    })
  })
}
