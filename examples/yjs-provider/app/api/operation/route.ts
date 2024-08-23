import { pool } from "../../db"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const { room, op, clientId } = await getRequestParams(request)

    if (!clientId) {
      saveOperation(room, op)
    } else {
      saveAwarenessOperation(room, op, clientId)
    }

    return NextResponse.json({})
  } catch (e) {
    const resp = e instanceof Error ? e.message : e
    return NextResponse.json(resp, { status: 400 })
  }
}

async function saveOperation(room: string, op: string) {
  const db = await pool.connect()
  try {
    await db.query(`INSERT INTO ydoc_operations (room, op) VALUES ($1, $2)`, [
      room,
      op,
    ])
  } finally {
    db.release()
  }
}

async function saveAwarenessOperation(
  room: string,
  op: string,
  clientId: string
) {
  const db = await pool.connect()
  try {
    await db.query(
      `INSERT INTO ydoc_awareness (room, clientId, op) VALUES ($1, $2, $3) 
       ON CONFLICT (clientId, room)
       DO UPDATE SET op = $3`,
      [room, clientId, op]
    )
  } finally {
    db.release()
  }
}

async function getRequestParams(
  request: Request
): Promise<{ room: string; op: string; clientId?: string }> {
  const { room, op, clientId } = await request.json()
  if (!room) {
    throw new Error(`'room' is required`)
  }
  if (!op) {
    throw new Error(`'op' is required`)
  }

  return { room, op, clientId }
}
