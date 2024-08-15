import { pool } from "../../db"
import { NextResponse } from "next/server"

// TODO: still loading yjs twice
import * as Y from "yjs"
import * as syncProtocol from "y-protocols/sync"

import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"

import { toBase64, fromBase64 } from "lib0/buffer"
import { PoolClient } from "pg"

const maxRowCount = 50

export async function POST(request: Request) {
  const db = await pool.connect()

  try {
    const body = await request.json()

    const errorResponse = validateRequest(body)
    if (errorResponse) {
      return errorResponse
    }

    await db.query(`BEGIN`)
    await db.query(
      `INSERT INTO ydoc_operations (room, op)
    VALUES ($1, $2)`,
      [body.room, body.op]
    )
    await maybeCompact(db, body.room)
    await db.query(`COMMIT`)

    return NextResponse.json({})
  } catch (e) {
    await db.query(`ROLLBACK`)
    throw e
  } finally {
    db.release()
  }
}

// naive implementation of compaction
async function maybeCompact(db: PoolClient, room: string) {
  const res = await db.query(
    `SELECT id, op FROM ydoc_operations
        WHERE room = $1
        ORDER BY id DESC`,
    [room]
  )

  if (res.rows.length < maxRowCount) {
    return
  }

  console.log(`compaction`)

  const ydoc = new Y.Doc()

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

  const encoder = encoding.createEncoder()
  syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(ydoc))
  const encoded = toBase64(encoding.toUint8Array(encoder))

  await db.query(`TRUNCATE ydoc_operations`)
  await db.query(
    `INSERT INTO ydoc_operations (room, op)
        VALUES ($1, $2)`,
    [room, encoded]
  )
}

function validateRequest({ room, op }: { room: string; op: string }) {
  if (!room) {
    return NextResponse.json({ error: `'room' is required` }, { status: 400 })
  }

  if (!op) {
    return NextResponse.json({ error: `'op' is required` }, { status: 400 })
  }
}
