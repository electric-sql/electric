import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShapeStream, isChangeMessage, Message, Row } from '../src'
import { snakeCamelMapper } from '../src/column-mapper'

describe(`ShapeStream`, () => {
  const shapeUrl = `https://example.com/v1/shape`
  let aborter: AbortController

  beforeEach(() => {
    aborter = new AbortController()
  })

  afterEach(() => aborter.abort())

  it(`should attach specified headers to requests`, async () => {
    const eventTarget = new EventTarget()
    const requestArgs: Array<RequestInit | undefined> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestArgs.push(args[1])
      eventTarget.dispatchEvent(new Event(`fetch`))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
      },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
      headers: {
        Authorization: `my-token`,
        'X-Custom-Header': `my-value`,
      },
    })
    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener(`fetch`, resolve, { once: true })
    )

    expect(requestArgs[0]).toMatchObject({
      headers: {
        Authorization: `my-token`,
        'X-Custom-Header': `my-value`,
      },
    })
  })

  it(`should sort query parameters for stable URLs`, async () => {
    const eventTarget = new EventTarget()
    const requestedUrls: Array<string> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestedUrls.push(args[0].toString())
      eventTarget.dispatchEvent(new Event(`fetch`))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
        where: `a=1`,
        columns: [`id`],
      },
      handle: `potato`,
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener(`fetch`, resolve, { once: true })
    )

    expect(requestedUrls[0].split(`?`)[1]).toEqual(
      `columns=%22id%22&handle=potato&log=full&offset=-1&table=foo&where=a%3D1`
    )
  })

  it(`should start requesting only after first subscription`, async () => {
    const eventTarget = new EventTarget()
    const fetchWrapper = (): Promise<Response> => {
      eventTarget.dispatchEvent(new Event(`fetch`))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
        where: `a=1`,
        columns: [`id`],
      },
      handle: `potato`,
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    // should not fire any fetch requests
    await new Promise<void>((resolve, reject) => {
      eventTarget.addEventListener(`fetch`, reject, { once: true })
      setTimeout(() => resolve(), 100)
    })

    // should fire fetch immediately after subbing
    const startedStreaming = new Promise<void>((resolve, reject) => {
      eventTarget.addEventListener(`fetch`, () => resolve(), {
        once: true,
      })
      setTimeout(() => reject(`timed out`), 100)
    })
    const unsub = stream.subscribe(() => unsub())
    await startedStreaming
  })

  it(`should correctly serialize objects into query params`, async () => {
    const eventTarget = new EventTarget()
    const requestedUrls: Array<string> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestedUrls.push(args[0].toString())
      eventTarget.dispatchEvent(new Event(`fetch`))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
        where: `a=$1 and b=$2`,
        columns: [`id`],
        params: {
          '1': `test1`,
          '2': `test2`,
        },
      },
      handle: `potato`,
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener(`fetch`, resolve, { once: true })
    )

    expect(requestedUrls[0].split(`?`)[1]).toEqual(
      `columns=%22id%22&handle=potato&log=full&offset=-1&params%5B1%5D=test1&params%5B2%5D=test2&table=foo&where=a%3D%241+and+b%3D%242`
    )
  })

  it(`should correctly serialize where clause param array to query params`, async () => {
    const eventTarget = new EventTarget()
    const requestedUrls: Array<string> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestedUrls.push(args[0].toString())
      eventTarget.dispatchEvent(new Event(`fetch`))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
        where: `a=$1 and b=$2`,
        columns: [`id`],
        params: [`test1`, `test2`],
      },
      handle: `potato`,
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener(`fetch`, resolve, { once: true })
    )

    expect(requestedUrls[0].split(`?`)[1]).toEqual(
      `columns=%22id%22&handle=potato&log=full&offset=-1&params%5B1%5D=test1&params%5B2%5D=test2&table=foo&where=a%3D%241+and+b%3D%242`
    )
  })

  it(`should encode columns with columnMapper`, async () => {
    const eventTarget = new EventTarget()
    const requestedUrls: Array<string> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestedUrls.push(args[0].toString())
      eventTarget.dispatchEvent(new Event(`fetch`))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
        columns: [`userId`, `createdAt`],
      },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
      columnMapper: snakeCamelMapper(),
    })

    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener(`fetch`, resolve, { once: true })
    )

    const url = new URL(requestedUrls[0])
    // columns should be encoded from app format (camelCase) to db format (snake_case)
    // and quoted for safe serialization
    expect(url.searchParams.get(`columns`)).toEqual(`"user_id","created_at"`)
  })

  it(`should encode where clause with columnMapper`, async () => {
    const eventTarget = new EventTarget()
    const requestedUrls: Array<string> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestedUrls.push(args[0].toString())
      eventTarget.dispatchEvent(new Event(`fetch`))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
        where: `userId = $1`,
      },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
      columnMapper: snakeCamelMapper(),
    })

    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener(`fetch`, resolve, { once: true })
    )

    const url = new URL(requestedUrls[0])
    // where clause should be encoded from app format (camelCase) to db format (snake_case)
    expect(url.searchParams.get(`where`)).toEqual(`user_id = $1`)
  })

  it(`should quote columns even when columnMapper is not provided`, async () => {
    const eventTarget = new EventTarget()
    const requestedUrls: Array<string> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestedUrls.push(args[0].toString())
      eventTarget.dispatchEvent(new Event(`fetch`))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
        columns: [`user_id`, `created_at`],
      },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener(`fetch`, resolve, { once: true })
    )

    const url = new URL(requestedUrls[0])
    // columns should be quoted for safe serialization
    expect(url.searchParams.get(`columns`)).toEqual(`"user_id","created_at"`)
  })

  it(`should handle columns with special characters`, async () => {
    const eventTarget = new EventTarget()
    const requestedUrls: Array<string> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestedUrls.push(args[0].toString())
      eventTarget.dispatchEvent(new Event(`fetch`))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
        columns: [`normal`, `has,comma`, `has"quote`],
      },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener(`fetch`, resolve, { once: true })
    )

    const url = new URL(requestedUrls[0])
    // columns with special characters should be properly quoted and escaped
    expect(url.searchParams.get(`columns`)).toEqual(
      `"normal","has,comma","has""quote"`
    )
  })

  it(`should decode data columns with columnMapper`, async () => {
    const receivedMessages: Message<Row>[] = []

    // Mock response with db column names (snake_case)
    // IMPORTANT: Must include an up-to-date control message, otherwise the
    // stream will keep requesting more data in an infinite loop
    const mockResponseData = [
      {
        key: `"public"."test"/"1"`,
        value: { user_id: `123`, created_at: `2025-01-01` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ]

    const fetchWrapper = (): Promise<Response> => {
      return Promise.resolve(
        new Response(JSON.stringify(mockResponseData), {
          status: 200,
          headers: {
            'content-type': `application/json`,
            'electric-handle': `test-handle`,
            'electric-offset': `0_0`,
            'electric-up-to-date': `true`,
            'electric-schema': JSON.stringify({
              user_id: { type: `text` },
              created_at: { type: `text` },
            }),
          },
        })
      )
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: `foo`,
        columns: [`userId`, `createdAt`],
      },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
      columnMapper: snakeCamelMapper(),
    })

    const unsub = stream.subscribe((messages) => {
      receivedMessages.push(...messages)
    })

    // Wait for messages to be processed
    await new Promise((resolve) => setTimeout(resolve, 100))

    unsub()
    aborter.abort()

    // Find the change message
    const changeMessage = receivedMessages.find(isChangeMessage)
    expect(changeMessage).toBeDefined()

    // Verify column names were decoded from snake_case to camelCase
    expect(changeMessage!.value).toHaveProperty(`userId`)
    expect(changeMessage!.value).toHaveProperty(`createdAt`)
    expect((changeMessage!.value as Record<string, unknown>).userId).toBe(`123`)
    expect((changeMessage!.value as Record<string, unknown>).createdAt).toBe(
      `2025-01-01`
    )

    // Verify original db column names are not present
    expect(changeMessage!.value).not.toHaveProperty(`user_id`)
    expect(changeMessage!.value).not.toHaveProperty(`created_at`)
  })
})
