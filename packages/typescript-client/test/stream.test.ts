import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShapeStream } from '../src'

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
    new ShapeStream({
      url: shapeUrl,
      table: `foo`,
      signal: aborter.signal,
      fetchClient: fetchWrapper,
      headers: {
        Authorization: `my-token`,
        'X-Custom-Header': `my-value`,
      },
    })

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
    new ShapeStream({
      url: shapeUrl,
      table: `foo`,
      where: `a=1`,
      columns: [`id`],
      handle: `potato`,
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    await new Promise((resolve) =>
      eventTarget.addEventListener(`fetch`, resolve, { once: true })
    )

    expect(requestedUrls[0].split(`?`)[1]).toEqual(
      `columns=id&handle=potato&offset=-1&table=foo&where=a%3D1`
    )
  })
})
