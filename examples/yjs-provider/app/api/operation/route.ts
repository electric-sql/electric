import { Client } from "pg"
import { NextResponse } from "next/server"

// TODO: need to use a connection pool for non-serverless deployments

const connectionString =
  process.env.POOLED_DATABASE_URL ||
  process.env.DATABASE_URL ||
  `postgresql://postgres:password@localhost:54321/electric`

export async function POST(request: Request) {
  const client = new Client({
    connectionString,
  })
  try {
    const { room, op, clientId } = await getRequestParams(request)
    await client.connect()

    if (!clientId) {
      await saveOperation(room, op, client)
    } else {
      await saveAwarenessOperation(room, op, clientId, client)
    }

    return NextResponse.json({})
  } catch (e) {
    const resp = e instanceof Error ? e.message : e
    return NextResponse.json(resp, { status: 400 })
  } finally {
    client.end()
  }
}

async function saveOperation(room: string, op: string, connection: Client) {
  await connection.query(
    `INSERT INTO ydoc_operations (room, op) VALUES ($1, decode($2, 'base64'))`,
    [room, op]
  )
}

async function saveAwarenessOperation(
  room: string,
  op: string,
  clientId: string,
  connection: Client
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
