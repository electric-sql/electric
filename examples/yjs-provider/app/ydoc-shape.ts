import { Shape, ShapeStream, ShapeStreamOptions } from "@electric-sql/client"

import { parseToUint8Array as parser, parseToBase64, room } from "./utils"

import * as Y from "yjs"
import * as syncProtocol from "y-protocols/sync"

import { toBase64 } from "lib0/buffer"
import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"
import { ReduceFunction, ReduceStream } from "./reduce-stream"

export type ShapeData = {
  data: string
  resume: {
    offset: string
    shapeHandle: string
  }
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
const url = process.env.ELECTRIC_URL
  ? `${process.env.ELECTRIC_URL}/v1/shape`
  : `http://localhost:3000/v1/shape/`


const doc: ShapeStreamOptions<Uint8Array> = {
  url,
  table: `ydoc_operations`,
  where: `room = '${room}'`,
  parser,
}
const docStream = new ShapeStream<YOp>(doc)
const docShape = getYDocShape(docStream)

export const getDocData = async () => {
  const doc = (await docShape.value).get(`ydoc_operations`)!.acc
  return {
    data: getDocAsBase64(doc),
    resume: {
      offset: docStream.lastOffset,
      shapeHandle: docStream.shapeHandle,
    },
  }
}

const awareness: ShapeStreamOptions = {
  url,
  table: `ydoc_awareness`,
  where: `room = '${room}'`,
  parser: parseToBase64,
}
const awarenessStream = new ShapeStream<YOp>(awareness)
const awarenessShape = new Shape(awarenessStream)

export const getAwarenessData = async () => {
  const clients = await awarenessShape.value
  const data = []
  for (const client of clients.values()) {
    data.push(client.op)
  }
  return {
    data: JSON.stringify(data),
    resume: {
      offset: awarenessStream.lastOffset,
      shapeHandle: awarenessStream.shapeHandle,
    },
  }
}
