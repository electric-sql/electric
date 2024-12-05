import { Pool } from "pg"
import { pool } from "../../db"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  let connected = false
  try {
    const { room, op, clientId } = await getRequestParams(request)
    await pool.connect()
    connected = true

    if (!clientId) {
      await saveOperation(room, op, pool)
    } else {
      await saveAwarenessOperation(room, op, clientId, pool)
    }

    return NextResponse.json({})
  } catch (e) {
    const resp = e instanceof Error ? e.message : e
    return NextResponse.json(resp, { status: 400 })
  } finally {
    if (connected) {
      pool.end()
    }
  }
}

async function saveOperation(room: string, op: string, connection: Pool) {
  await connection.query(
    `INSERT INTO ydoc_operations (room, op) VALUES ($1, decode($2, 'base64'))`,
    [room, op]
  )
}

async function saveAwarenessOperation(
  room: string,
  op: string,
  clientId: string,
  connection: Pool
) {
  await connection.query(
    `INSERT INTO ydoc_awareness (room, clientId, op) VALUES ($1, $2, decode($3, 'base64'))
       ON CONFLICT (clientId, room)
       DO UPDATE SET op = decode($3, 'base64')`,
    [room, clientId, op]
  )
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
