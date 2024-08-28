import { Offset, ShapeStream } from "@electric-sql/client"

import * as Y from "yjs"
import * as syncProtocol from "y-protocols/sync"

import * as url from "lib0/url"
import { fromBase64, toBase64 } from "lib0/buffer"
import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"

export type ShapeData = {
  doc: string
  offset: string
  shapeId: string
  // TODO: awareness
}

const ydoc = new Y.Doc()

let cached: string | null = null
let offset: Offset = "-1"

const encodedParams = url.encodeQueryParams({
  where: `room = 'electric-demo'`,
})

const stream = new ShapeStream({
  url: `http://localhost:3000//v1/shape/ydoc_operations?` + encodedParams,
})

stream.subscribe((messages) => {
  messages.map((message: any) => {
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
    shapeId: stream["shapeId"]!,
  }
}

function getDocAsBase64() {
  const encoder = encoding.createEncoder()
  syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(ydoc))
  return toBase64(encoding.toUint8Array(encoder))
}
