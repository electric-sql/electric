import { pool } from "../../db"
import { NextRequest, NextResponse } from "next/server"

import * as Y from "yjs"
import * as syncProtocol from "y-protocols/sync"

import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"

import { toBase64, fromBase64 } from "lib0/buffer"

export async function GET(request: NextRequest) {
  try {
    const { room } = await getRequestParams(request)

    doCompation(room)

    return NextResponse.json({})
  } catch (e) {
    const resp = e instanceof Error ? e.message : e
    return NextResponse.json(resp, { status: 400 })
  }
}

async function doCompation(room: string) {
  const db = await pool.connect()
  try {
    await db.query(`BEGIN`)
    const res = await db.query(
      `DELETE FROM ydoc_operations
        WHERE room = $1 
        RETURNING *`,
      [room]
    )

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

    await db.query(
      `INSERT INTO ydoc_operations (room, op)
          VALUES ($1, $2)`,
      [room, encoded]
    )
    await db.query(`COMMIT`)
  } catch (e) {
    await db.query(`ROLLBACK`)
    throw e
  } finally {
    db.release()
  }
}

async function getRequestParams(
  request: NextRequest
): Promise<{ room: string }> {
  const room = await request.nextUrl.searchParams.get(`room`)
  if (!room) {
    throw new Error(`'room' is required`)
  }

  return { room }
}
