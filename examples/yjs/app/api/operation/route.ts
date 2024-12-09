import { Pool } from "pg"
import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

// hybrid implementation for connection pool and serverless with neon

const connectionString =
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL ||
  `postgresql://postgres:password@localhost:54321/electric`

const sql = process.env.NEON_DATABASE_URL ? neon(connectionString) : undefined

const pool = !process.env.NEON_DATABASE_URL
  ? new Pool({ connectionString })
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
  const q = `INSERT INTO ydoc_operations (room, op) VALUES ($1, decode($2, 'base64'))`
  const params = [room, op]
  await runQuery(q, params)
}

async function saveAwarenessOperation(
  room: string,
  op: string,
  clientId: string
) {
  const q = `INSERT INTO ydoc_awareness (room, clientId, op) VALUES ($1, $2, decode($3, 'base64'))
       ON CONFLICT (clientId, room)
       DO UPDATE SET op = decode($3, 'base64'), updated = now()`
  const params = [room, clientId, op]
  await runQuery(q, params)
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

async function runQuery(q: string, params: string[]) {
  if (pool) {
    await pool.query(q, params)
  } else if (sql) {
    await sql(q, params)
  } else {
    throw new Error(`No database driver provided`)
  }
}
