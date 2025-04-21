import * as decoding from "lib0/decoding"
import { Offset, ShapeStreamOptions } from "@electric-sql/client"

export type OperationSteamOptions = Omit<
  ShapeStreamOptions<decoding.Decoder>,
  `subscribe` | `signal`
> & { parser: { bytea: (hexString: string) => decoding.Decoder } }
export type AwarenessSteamOptions = Omit<
  ShapeStreamOptions<decoding.Decoder>,
  `subscribe` | `signal`
> & { parser: { bytea: (hexString: string) => decoding.Decoder } }

export type OperationMessage = {
  op: decoding.Decoder
}

export type AwarenessMessage = {
  client_id: string
  op: decoding.Decoder
}

export type ResumeState = {
  operations?: {
    offset: Offset
    handle: string
  }
  awareness?: {
    offset: Offset
    handle: string
  }
  batching?: Uint8Array
  sending?: Uint8Array
}

/**
 * Interface for shape stream resume state providers
 * TODO: this needs to become async to be able to use Indexeddb and others
 */
export interface ResumeStateProvider {
  /**
   * Save the current resume state
   * @param state The resume state to save
   */
  save(state: ResumeState): void

  /**
   * Load the previously saved resume state
   * @returns The saved resume state or undefined if none exists
   */
  load(): ResumeState | undefined
}

export type YProvider = {
  sync: (state: boolean) => void
  synced: (state: boolean) => void
  status: (status: {
    status: `connecting` | `connected` | `disconnected`
  }) => void
  // eslint-disable-next-line quotes
  "connection-close": () => void
}
