import {
  GetExtensions,
  Offset,
  Row,
  ShapeStreamOptions,
} from "@electric-sql/client"
import * as decoding from "lib0/decoding"
import * as awarenessProtocol from "y-protocols/awareness"
import * as Y from "yjs"

export type SendErrorRetryHandler = ({
  response,
  error,
}: {
  response?: Response
  error?: unknown
}) => Promise<boolean>

export type ElectricProviderOptions<
  RowWithDocumentUpdate extends Row<decoding.Decoder>,
  RowWithAwarenessUpdate extends Row<decoding.Decoder>,
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
export type ElectricResumeStateProvider = {
  synced: (state: ResumeState) => void
}

export type YProvider = {
  resumeState: (resumeState: ResumeState) => void
  sync: (state: boolean) => void
  synced: (state: boolean) => void
  status: (status: {
    status: `connecting` | `connected` | `disconnected`
  }) => void
  // eslint-disable-next-line quotes
  "connection-close": () => void
}
