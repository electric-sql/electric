import { NextResponse } from "next/server"
import { Pool } from "pg"

const client = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    `postgresql://postgres:password@localhost:54321/electric`,
})

export async function POST(request: Request) {
  const body = await request.json()
  const result = await client.query(
    `INSERT INTO items (id)
      VALUES ($1) RETURNING id;`,
    [body.uuid]
  )
  return NextResponse.json({ id: result.rows[0].id })
}

export async function DELETE() {
  await client.query(`DELETE FROM items;`)
  return NextResponse.json(`ok`)
}
