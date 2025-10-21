import {
  GetExtensions,
  Offset,
  Row,
  ShapeStreamOptions,
} from "@electric-sql/client"
import * as decoding from "lib0/decoding"
import * as awarenessProtocol from "y-protocols/awareness"
import * as Y from "yjs"

export type ConnectivityStatus = "connected" | "disconnected" | "connecting"

/**
 * A function that handles send errors.
 * @param response The http response from the server if the server returned a response.
 * @param error An exception raised by the fetch client if the server did not return a response.
 * @returns A promise that resolves to true if the send request should be retried.
 */
export type SendErrorRetryHandler = ({
  response,
  error,
}: {
  response?: Response
  error?: unknown
}) => Promise<boolean>

/**
 * The Observable interface for the YElectric provider.
 *
 * @event resumeState emitted when the provider sends or receives an update. This is mainly consumed by ResumeStateProvider to persist the resume state.
 * @event sync Emitted when the provider receives an up-to-date control message from the server, meaning that the client caught up with latest changes from the server.
 * @event synced same as @event sync.
 * @event status Emitted when the provider's connectivity status changes.
 * @event "connection-close" Emitted when the client disconnects from the server, by unsubscribing from shapes.
 */
export type YProvider = {
  resumeState: (resumeState: ResumeState) => void
  sync: (state: boolean) => void
  synced: (state: boolean) => void
  status: (status: {
    status: "connecting" | "connected" | "disconnected"
  }) => void
   
  "connection-close": () => void
}

/**
 * The Observable interface for a ResumeStateProvider
 * A resume state provider is used to persist the sync state of a document
 * This is composed of:
 * - The document shape offset and handle
 * - The awareness shape offset and handle (optional)
 * - The state vector of the document synced to the server (optional)
 */
export type ElectricResumeStateProvider = {
  synced: (state: ResumeState) => void
}

/**
 * Options for the ElectricProvider.
 *
 * @template RowWithDocumentUpdate The type of the row that contains the document update.
 * @template RowWithAwarenessUpdate (optional) The type of the row that contains the awareness update.
 * @param documentUpdates Options for the document updates.
 * @param documentUpdates.shape Options for the document updates shape.
 * @param documentUpdates.sendUrl The URL to send the document updates to.
 * @param documentUpdates.getUpdateFromRow A function that returns the update column from the row.
 * @param documentUpdates.sendErrorRetryHandler (optional) A function that handles send errors.
 * @param awarenessUpdates (optional) Options for the awareness updates.
 * @param awarenessUpdates.shape Options for the awareness updates shape.
 * @param awarenessUpdates.sendUrl The URL to send the awareness updates to.
 * @param awarenessUpdates.getUpdateFromRow A function that returns the update column from the row.
 * @param awarenessUpdates.sendErrorRetryHandler (optional) A function that handles send errors.
 * @param resumeState (optional) The resume state to use for the provider. If no resume state the provider will fetch the entire shape.
 * @param connect (optional) Whether to automatically connect upon initialization.
 * @param fetchClient (optional) Custom fetch implementation to use for send requests.
 */
export type ElectricProviderOptions<
  RowWithDocumentUpdate extends Row<decoding.Decoder>,
  RowWithAwarenessUpdate extends Row<decoding.Decoder> = never,
> = {
  doc: Y.Doc
  documentUpdates: {
    shape: ShapeStreamOptions<GetExtensions<RowWithDocumentUpdate>>
    sendUrl: string | URL
    getUpdateFromRow: (row: RowWithDocumentUpdate) => decoding.Decoder
    sendErrorRetryHandler?: SendErrorRetryHandler
  }
  awarenessUpdates?: {
    shape: ShapeStreamOptions<GetExtensions<RowWithAwarenessUpdate>>
    sendUrl: string | URL
    protocol: awarenessProtocol.Awareness
    getUpdateFromRow: (row: RowWithAwarenessUpdate) => decoding.Decoder
    sendErrorRetryHandler?: SendErrorRetryHandler
  }
  resumeState?: ResumeState
  connect?: boolean
  fetchClient?: typeof fetch
}

export type ResumeState = {
  document?: {
    offset: Offset
    handle: string
  }
  awareness?: {
    offset: Offset
    handle: string
  }

  // The vector of the document at the time of the last sync.
  // When the provider starts, it batches the diff between this
  // vector and the current state of the document to send upstream.
  stableStateVector?: Uint8Array
}
