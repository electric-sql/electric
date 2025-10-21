import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  MockInstance,
} from "vitest"
import * as Y from "yjs"
import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"
import { ElectricProvider } from "../src/y-electric"
import { createMockProvider, feedMessage } from "./test-utils"

vi.stubGlobal("fetch", vi.fn())

describe("ElectricProvider upstream/downstream changes", () => {
  let doc: Y.Doc
  let provider: ElectricProvider
  // Use a simple type for the spy in tests
  let sendSpy: MockInstance

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(fetch).mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          "electric-offset": "123",
          "electric-handle": "test-handle",
          "electric-schema": "test-schema",
        },
      })
    )

    doc = new Y.Doc()
    provider = createMockProvider(doc)

    sendSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 200 }))
      )
  })

  afterEach(() => {
    provider.destroy()
  })

  it("should call send when Y.Text is modified", () => {
    feedMessage([])

    const ytext = doc.getText("test-text")

    ytext.insert(0, "Hello, Electric!")

    expect(ytext.toString()).toBe("Hello, Electric!")
    expect(sendSpy).toHaveBeenCalledTimes(1)
  })

  it("should apply remote updates to the document", () => {
    const sourceDoc = new Y.Doc()
    sourceDoc.getText("shared").insert(0, "Hello Electric YJS!")
    const text = doc.getText("shared")

    const update = Y.encodeStateAsUpdate(sourceDoc)
    const encoder = encoding.createEncoder()
    encoding.writeVarUint8Array(encoder, update)
    const decoder = decoding.createDecoder(encoding.toUint8Array(encoder))

    feedMessage([
      {
        headers: { operation: "insert" },
        key: "id1",
        value: { op: decoder },
      },
    ])

    expect(text.toString()).toBe("Hello Electric YJS!")
  })
})

describe("ElectricProvider connectivity handling", () => {
  let doc: Y.Doc
  let provider: ElectricProvider
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    doc = new Y.Doc()

    mockFetch = vi.fn().mockImplementation((url, init) => {
      const requestBody = init?.body

      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "test-id",
            body:
              requestBody instanceof Uint8Array
                ? { data: Array.from(requestBody) }
                : requestBody,
          }),
        status: 200,
        text: () => Promise.resolve(""),
      })
    })

    provider = createMockProvider(doc, { fetchClient: mockFetch })

    feedMessage([])
  })

  afterEach(() => {
    provider.destroy()
  })

  it("should not send operations when disconnected", async () => {
    expect(provider.connected).toBe(true)

    const ytext = doc.getText("test")
    ytext.insert(0, "hello")

    expect(mockFetch).toHaveBeenCalled()
    mockFetch.mockClear()

    provider.disconnect()
    expect(provider.connected).toBe(false)

    ytext.insert(5, " world")

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("should merge operations while disconnected and send them when reconnected", async () => {
    provider.disconnect()
    expect(provider.connected).toBe(false)

    const ytext = doc.getText("test")

    const sendOperationSpy: ReturnType<typeof vi.spyOn> = vi.spyOn(
      provider as unknown as { sendOperations: () => Promise<void> },
      "sendOperations"
    )

    ytext.insert(0, "hello")
    ytext.insert(5, " world")

    expect(sendOperationSpy).toHaveBeenCalledTimes(2)

    provider.connect()
    expect(provider.connected).toBe(false)

    feedMessage([])

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const fetchCall = mockFetch.mock.calls[0]
    const requestBody = fetchCall[1]?.body as Uint8Array

    const newDoc = new Y.Doc()
    const decoder = decoding.createDecoder(requestBody)

    const update = decoding.readVarUint8Array(decoder)
    Y.applyUpdate(newDoc, update)

    expect(newDoc.getText("test").toString()).toBe("hello world")
  })

  it("should not apply external updates when disconnected", async () => {
    const sourceDoc = new Y.Doc()
    sourceDoc.getText("test").insert(0, "test content")
    const update = Y.encodeStateAsUpdate(sourceDoc)

    const encoder = encoding.createEncoder()
    encoding.writeVarUint8Array(encoder, update)
    const decoder = decoding.createDecoder(encoding.toUint8Array(encoder))

    const text = doc.getText("test")
    expect(text.toString()).toBe("")

    provider.disconnect()
    expect(provider.connected).toBe(false)

    feedMessage([
      {
        headers: { operation: "insert" },
        key: "test-id",
        value: { op: decoder },
      },
    ])

    expect(text.toString()).toBe("")
  })

  it("should remove all update handlers when disconnected", () => {
    console.dir(doc._observers)
    const initialUpdateHandlers = doc._observers.get("update")!.size
    expect(initialUpdateHandlers).toBeGreaterThan(0)

    provider.disconnect()
    provider.destroy()

    const finalUpdateHandlers = doc._observers.get("update")
    expect(finalUpdateHandlers).toBeUndefined()
  })
})
