import { vi, Mock } from "vitest"
import * as Y from "yjs"
import { ElectricProvider } from "../src/y-electric"
import { Message, Row, ShapeStream } from "@electric-sql/client"
import * as decoding from "lib0/decoding"

// Mock the Electric client library
vi.mock("@electric-sql/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@electric-sql/client")>()
  const ShapeStream = vi.fn(() => ({
    subscribe: vi.fn().mockReturnValue(vi.fn()),
    unsubscribeAll: vi.fn(),
    isUpToDate: true,
    shapes: {},
  }))
  return { ...mod, ShapeStream }
})

export const MockShapeStream = ShapeStream as unknown as Mock

// Feed message function for simulating server responses
export let feedMessage: (messages: Message<Row<decoding.Decoder>>[]) => void =
  vi.fn()

export function createMockProvider(
  doc: Y.Doc,
  options: {
    fetchClient?: Mock
    connect?: boolean
  } = {}
): ElectricProvider {
  MockShapeStream.mockImplementation(() => {
    let unsubscribed = false
    return {
      subscribe: vi.fn(
        (cb: (messages: Message<Row<decoding.Decoder>>[]) => Promise<void>) => {
          feedMessage = (messages) => {
            if (unsubscribed) {
              return
            }
            return cb([
              ...messages,
              {
                headers: {
                  control: "up-to-date",
                },
              },
            ])
          }
          return vi.fn(() => {
            unsubscribed = true
          })
        }
      ),
      unsubscribeAll: vi.fn(),
      isConnected: () => !unsubscribed,
    }
  })

  // Create the real provider
  const provider = new ElectricProvider<{ op: decoding.Decoder }>({
    doc,
    documentUpdates: {
      shape: {
        url: "http://localhost:3000/v1/subscriptions",
      },
      sendUrl: "/ops",
      getUpdateFromRow: (row) => row.op,
    },
    connect: options.connect ?? true,
    fetchClient: options.fetchClient,
  })

  return provider
}
