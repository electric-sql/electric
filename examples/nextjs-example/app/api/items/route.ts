import { NextResponse } from "next/server"
import { Client } from "pg"

const client = new Client({
  connectionString: process.env.DATABASE_POOLED_URL,
})

export async function POST(request: Request) {
  const body = await request.json()

  try {
    await client.connect()
    const result = await client.query(
      `INSERT INTO items (id)
      VALUES ($1) RETURNING id;`,
      [body.uuid]
    )
    return NextResponse.json({ id: result.rows[0].id })
  } finally {
    await client.end()
  }
}

export async function DELETE() {
  try {
    await client.connect()
    await client.query(`DELETE FROM items;`)
  } finally {
    await client.end()
  }
  return NextResponse.json(`ok`)
}
