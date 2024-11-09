import {
  isChangeMessage,
  isControlMessage,
  Offset,
  ShapeStream,
} from "@electric-sql/client"

import * as Y from "yjs"
import * as syncProtocol from "y-protocols/sync"

import * as url from "lib0/url"
import { fromBase64, toBase64 } from "lib0/buffer"
import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"

export type ShapeData = {
  doc: string
  offset: string
  shapeHandle: string
}

const ydoc = new Y.Doc()

let cached: string | null = null
let offset: Offset = "-1"

const stream = new ShapeStream({
  url: `http://localhost:3000/v1/shape/`,
  table: `ydoc_operations`,
  where: `room = 'electric-demo'`,
})

stream.subscribe((messages) => {
  messages.map((message: any) => {
    if (isControlMessage(message)) {
      return
    }
    const op = fromBase64(message[`value`][`op`])
    syncProtocol.readSyncMessage(
      decoding.createDecoder(op),
      encoding.createEncoder(),
      ydoc,
      `server`
    )
    offset = message[`offset`]
    cached = null
  })
})

export function getShapeData(): ShapeData {
  return {
    doc: cached ?? (cached = getDocAsBase64()),
    offset,
    shapeHandle: stream.shapeHandle,
  }
}

function getDocAsBase64() {
  const encoder = encoding.createEncoder()
  syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(ydoc))
  return toBase64(encoding.toUint8Array(encoder))
}
