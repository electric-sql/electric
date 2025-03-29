import { vi, Mock } from "vitest"
import * as Y from "yjs"
import { ElectricProvider } from "../src/lib/y-electric"
import { Message, ShapeStream } from "@electric-sql/client"
import { OperationMessage } from "../src/lib/types"
import { parseToDecoder } from "../src/common/utils"

// Mock the Electric client library
vi.mock(`@electric-sql/client`, async (importOriginal) => {
  // eslint-disable-next-line quotes
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
export let feedMessage: (messages: Message<OperationMessage>[]) => void =
  vi.fn()

export function createMockProvider(
  doc: Y.Doc,
  options: {
    fetchClient?: typeof fetch
    connect?: boolean
  } = {}
): ElectricProvider {
  MockShapeStream.mockImplementation(() => {
    let unsubscribed = false
    return {
      subscribe: vi.fn(
        (cb: (messages: Message<OperationMessage>[]) => Promise<void>) => {
          feedMessage = (messages) => {
            if (unsubscribed) {
              return
            }
            return cb([
              ...messages,
              {
                headers: {
                  control: `up-to-date`,
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
  const provider = new ElectricProvider({
    doc,
    operations: {
      options: {
        url: `http://localhost:3000/v1/subscriptions`,
        parser: parseToDecoder,
      },
      endpoint: `/ops`,
    },
    connect: options.connect ?? true,
    fetchClient: options.fetchClient,
  })

  return provider
}
