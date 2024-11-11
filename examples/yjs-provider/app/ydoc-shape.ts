import { Offset, Shape, ShapeStream } from "@electric-sql/client"

import { parser } from "./utils"

import * as Y from "yjs"
import * as syncProtocol from "y-protocols/sync"

import { toBase64 } from "lib0/buffer"
import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"
import { ReduceFunction, ReduceStream } from "./reduce-stream"

export type ShapeData = {
  doc: string
  offset: string
  shapeHandle: string
}

let offset: Offset = "-1"
let room = `electric-demo`

const stream = new ShapeStream<{ op: Uint8Array }>({
  url: `http://localhost:3000/v1/shape/`,
  table: `ydoc_operations`,
  where: `room = '${room}'`,
  parser,
})

const reduceChangesToDoc: ReduceFunction<{ op: Uint8Array }, Y.Doc> = (
  acc,
  message
) => {
  syncProtocol.readSyncMessage(
    decoding.createDecoder(message.value.op),
    encoding.createEncoder(),
    acc,
    `server`
  )
  offset = message[`offset`]
  return acc
}

const reduceStream = new ReduceStream(stream, reduceChangesToDoc, new Y.Doc())
const shape = new Shape(reduceStream)

export async function getShapeData(): Promise<ShapeData> {
  const doc = (await shape.value).get("ydoc_operations")!.acc
  return {
    doc: getDocAsBase64(doc),
    offset,
    shapeHandle: stream.shapeHandle,
  }
}

function getDocAsBase64(ydoc: Y.Doc) {
  const encoder = encoding.createEncoder()
  syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(ydoc))
  return toBase64(encoding.toUint8Array(encoder))
}
