import { db } from "../../db"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const body = await request.json()

  await db.query(
    `INSERT INTO ydoc_awareness (client, name, op)
     VALUES ($1, $2, $3)
     ON CONFLICT (client, name)
     DO UPDATE SET op = $3`,
    [body.client, body.name, body.op]
  )

  return NextResponse.json({})
}
