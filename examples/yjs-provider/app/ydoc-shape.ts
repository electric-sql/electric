import {
  Row,
  Shape,
  ShapeStream,
  ShapeStreamOptions,
} from "@electric-sql/client"

import { parseToUint8Array as parser } from "./utils"

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
type YOp = { op: Uint8Array }
type YDoc = { acc: Y.Doc }

function getYDocShape(stream: ShapeStream<YOp>): Shape<YDoc> {
  const reduceChangesToDoc: ReduceFunction<YOp, Y.Doc> = (acc, message) => {
    syncProtocol.readSyncMessage(
      decoding.createDecoder(message.value.op),
      encoding.createEncoder(),
      acc,
      `server`
    )
    return acc
  }

  const reduceStream = new ReduceStream(stream, reduceChangesToDoc, new Y.Doc())
  return new Shape(reduceStream)
}

function getDocAsBase64(ydoc: Y.Doc) {
  const encoder = encoding.createEncoder()
  syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(ydoc))
  return toBase64(encoding.toUint8Array(encoder))
}

const options: ShapeStreamOptions<Uint8Array> = {
  url: `http://localhost:3000/v1/shape/`,
  table: `ydoc_operations`,
  where: `room = 'electric-demo'`,
  parser,
}

const stream = new ShapeStream<YOp>(options)
const shape = getYDocShape(stream)

export const getShapeData = async () => {
  const doc = (await shape.value).get("ydoc_operations")!.acc
  console.log("offset", stream.lastOffset)
  return {
    doc: getDocAsBase64(doc),
    offset: stream.lastOffset,
    shapeHandle: stream.shapeHandle,
  }
}
