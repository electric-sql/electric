import nodePkg from "@remix-run/node"
const { json } = nodePkg
import type { ActionFunctionArgs } from "@remix-run/node"
import { db } from "../db"
import { v4 as uuidv4 } from "uuid"

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === `POST`) {
    console.log(`hi`)
    const result = await db.query(
      `INSERT INTO workers (id, status)
    VALUES ($1, $2) RETURNING id;`,
      [uuidv4(), `idle`]
    )
    return json({ id: result.rows[0].id })
  }
}
