import { db } from "../../db"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const body = await request.json()
  console.log({ body })
  const result = await db.query(
    `INSERT INTO items (id)
    VALUES ($1) RETURNING id;`,
    [body.uuid]
  )
  return NextResponse.json({ id: result.rows[0].id })
}

export async function DELETE() {
  await db.query(`DELETE FROM items;`)
  return NextResponse.json(`ok`)
}
