import { Pool } from "pg"
import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

// hybrid implementation for connection pool and serverless with neon

// TODO: remove entries from awareness vector
// TODO: cleanup operations log for compaction

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

async function saveOperation(room: string, op: Uint8Array) {
  const q = `INSERT INTO ydoc_operations (room, op) VALUES ($1, $2)`
  const params = [room, op]
  await runQuery(q, params)
}

async function saveAwarenessOperation(
  room: string,
  op: Uint8Array,
  clientId: string
) {
  const q = `INSERT INTO ydoc_awareness (room, clientId, op) VALUES ($1, $2, $3)
       ON CONFLICT (clientId, room)
       DO UPDATE SET op = $3, updated = now()`
  const params = [room, clientId, op]
  await runQuery(q, params)
}

async function getRequestParams(
  request: Request
): Promise<{ room: string; op: Uint8Array; clientId?: string }> {
  const url = new URL(request.url)
  const room = url.searchParams.get(`room`)
  const clientId = url.searchParams.get(`clientId`)

  if (!room) {
    throw new Error(`'room' query parameter is required`)
  }

  const op = new Uint8Array(await request.arrayBuffer())
  if (op.length === 0) {
    throw new Error(`Operation data is required`)
  }

  return {
    room,
    op,
    clientId: clientId ?? undefined,
  }
}

async function runQuery(q: string, params: (string | Uint8Array)[]) {
  if (pool) {
    await pool.query(q, params)
  } else if (sql) {
    await sql(q, params)
  } else {
    throw new Error(`No database driver provided`)
  }
}
