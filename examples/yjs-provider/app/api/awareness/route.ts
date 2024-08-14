import { db } from "../../db"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const body = await request.json()

  await db.query(
    `INSERT INTO ydoc_awareness (client, room, op)
     VALUES ($1, $2, $3)
     ON CONFLICT (client, room)
     DO UPDATE SET op = $3`,
    [body.client, body.room, body.op]
  )

  return NextResponse.json({})
}
