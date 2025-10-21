import nodePkg from "@remix-run/node"
const { json } = nodePkg
import type { ActionFunctionArgs } from "@remix-run/node"
import { pool } from "../db"

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "POST") {
    const body = await request.json()
    const result = await pool.query(
      `INSERT INTO items (id)
    VALUES ($1) RETURNING id;`,
      [body.uuid]
    )
    return json({ id: result.rows[0].id })
  }

  if (request.method === "DELETE") {
    await pool.query("DELETE FROM items;")

    return "ok"
  }
}
