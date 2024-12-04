import { pool } from "../../db"
import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

const sql = process.env.POOLED_DATABASE_URL
  ? neon(process.env.POOLED_DATABASE_URL)
  : undefined

export async function POST(request: Request) {
  try {
    const { room, op, clientId } = await getRequestParams(request)

    if (!clientId) {
      await saveOperation(room, op)
    } else {
      await saveAwarenessOperation(room, op, clientId)
    }

    return NextResponse.json({})
  } catch (e) {
    const resp = e instanceof Error ? e.message : e
    return NextResponse.json(resp, { status: 400 })
  }
}

async function saveOperation(room: string, op: string) {
  if (sql) {
    await sql`
      INSERT INTO ydoc_operations (room, op) VALUES (${room}, decode(${op}, 'base64'))
    `
  } else {
    await pool!.query(
      `INSERT INTO ydoc_operations (room, op) VALUES ($1, decode($2, 'base64'))`,
      [room, op]
    )
  }
}

async function saveAwarenessOperation(
  room: string,
  op: string,
  clientId: string
) {
  if (sql) {
    await sql`
      INSERT INTO ydoc_awareness (room, clientId, op) VALUES (${room}, ${clientId}, decode(${op}, 'base64'))
      ON CONFLICT (clientId, room)
      DO UPDATE SET op = decode(${op}, 'base64')
    `
  } else {
    await pool!.query(
      `INSERT INTO ydoc_awareness (room, clientId, op) VALUES ($1, $2, decode($3, 'base64'))
       ON CONFLICT (clientId, room)
       DO UPDATE SET op = decode($3, 'base64')`,
      [room, clientId, op]
    )
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
