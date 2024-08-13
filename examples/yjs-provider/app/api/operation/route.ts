import { db } from "../../db"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const body = await request.json()
  await db.query(
    `INSERT INTO ydoc_operations (name, op)
    VALUES ($1, $2)`,
    [body.name, body.op]
  )
  return NextResponse.json({})
}
