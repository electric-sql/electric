import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ShapeStream } from "../src"

describe("ShapeStream", () => {
  const shapeUrl = "https://example.com/v1/shape"
  let aborter: AbortController

  beforeEach(() => {
    aborter = new AbortController()
  })

  afterEach(() => aborter.abort())

  it("should attach specified headers to requests", async () => {
    const eventTarget = new EventTarget()
    const requestArgs: Array<RequestInit | undefined> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestArgs.push(args[1])
      eventTarget.dispatchEvent(new Event("fetch"))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: "foo",
      },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
      headers: {
        Authorization: "my-token",
        "X-Custom-Header": "my-value",
      },
    })
    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener("fetch", resolve, { once: true })
    )

    expect(requestArgs[0]).toMatchObject({
      headers: {
        Authorization: "my-token",
        "X-Custom-Header": "my-value",
      },
    })
  })

  it("should sort query parameters for stable URLs", async () => {
    const eventTarget = new EventTarget()
    const requestedUrls: Array<string> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestedUrls.push(args[0].toString())
      eventTarget.dispatchEvent(new Event("fetch"))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: "foo",
        where: "a=1",
        columns: ["id"],
      },
      handle: "potato",
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener("fetch", resolve, { once: true })
    )

    expect(requestedUrls[0].split("?")[1]).toEqual(
      "columns=id&handle=potato&log=full&offset=-1&table=foo&where=a%3D1"
    )
  })

  it("should start requesting only after first subscription", async () => {
    const eventTarget = new EventTarget()
    const fetchWrapper = (): Promise<Response> => {
      eventTarget.dispatchEvent(new Event("fetch"))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: "foo",
        where: "a=1",
        columns: ["id"],
      },
      handle: "potato",
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    // should not fire any fetch requests
    await new Promise<void>((resolve, reject) => {
      eventTarget.addEventListener("fetch", reject, { once: true })
      setTimeout(() => resolve(), 100)
    })

    // should fire fetch immediately after subbing
    const startedStreaming = new Promise<void>((resolve, reject) => {
      eventTarget.addEventListener("fetch", () => resolve(), {
        once: true,
      })
      setTimeout(() => reject("timed out"), 100)
    })
    const unsub = stream.subscribe(() => unsub())
    await startedStreaming
  })

  it("should correctly serialize objects into query params", async () => {
    const eventTarget = new EventTarget()
    const requestedUrls: Array<string> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestedUrls.push(args[0].toString())
      eventTarget.dispatchEvent(new Event("fetch"))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: "foo",
        where: "a=$1 and b=$2",
        columns: ["id"],
        params: {
          "1": "test1",
          "2": "test2",
        },
      },
      handle: "potato",
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener("fetch", resolve, { once: true })
    )

    expect(requestedUrls[0].split("?")[1]).toEqual(
      "columns=id&handle=potato&log=full&offset=-1&params%5B1%5D=test1&params%5B2%5D=test2&table=foo&where=a%3D%241+and+b%3D%242"
    )
  })

  it("should correctly serialize where clause param array to query params", async () => {
    const eventTarget = new EventTarget()
    const requestedUrls: Array<string> = []
    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      requestedUrls.push(args[0].toString())
      eventTarget.dispatchEvent(new Event("fetch"))
      return Promise.resolve(Response.error())
    }

    const aborter = new AbortController()
    const stream = new ShapeStream({
      url: shapeUrl,
      params: {
        table: "foo",
        where: "a=$1 and b=$2",
        columns: ["id"],
        params: ["test1", "test2"],
      },
      handle: "potato",
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })

    const unsub = stream.subscribe(() => unsub())

    await new Promise((resolve) =>
      eventTarget.addEventListener("fetch", resolve, { once: true })
    )

    expect(requestedUrls[0].split("?")[1]).toEqual(
      "columns=id&handle=potato&log=full&offset=-1&params%5B1%5D=test1&params%5B2%5D=test2&table=foo&where=a%3D%241+and+b%3D%242"
    )
  })
})
