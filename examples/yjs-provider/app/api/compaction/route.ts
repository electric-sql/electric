import { db } from "../../db"
import { NextRequest, NextResponse } from "next/server"

import * as Y from "yjs"
import * as syncProtocol from "y-protocols/sync"

import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"

import { toBase64, fromBase64 } from "lib0/buffer"

const ydoc = new Y.Doc()

export async function GET(request: NextRequest) {
  const room = request.nextUrl.searchParams.get(`room`)

  if (!room) {
    return NextResponse.json({ error: `room is required` }, { status: 400 })
  }

  const res = await db.query(
    `SELECT id, op FROM ydoc_operations
        WHERE name = $1
        ORDER BY id ASC
        LIMIT 1000`,
    [room]
  )

  const ytext = ydoc.getText(room)
  res.rows.map(({ op }) => {
    const buf = fromBase64(op)
    const decoder = decoding.createDecoder(buf)
    syncProtocol.readSyncMessage(
      decoder,
      encoding.createEncoder(),
      ydoc,
      `server`
    )
  })

  await db.query(
    `DELETE FROM ydoc_operations
        WHERE name = $1 AND id <= $2`,
    [room, res.rows[res.rows.length - 1].id]
  )

  const encoder = encoding.createEncoder()
  syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(ydoc))
  const encoded = toBase64(encoding.toUint8Array(encoder))

  await db.query(
    `INSERT INTO ydoc_operations (name, op)
    VALUES ($1, $2)`,
    [room, encoded]
  )

  return NextResponse.json({ text: ytext.toJSON() })
}
