import { Pool } from "pg"

export type Operation = {
  room: string
  op: Uint8Array
}

export type AwarenessOperation = Operation & {
  client_id: string
}

export async function saveOperation({ room, op }: Operation, pool: Pool) {
  const q = `INSERT INTO ydoc_operations (room, op) VALUES ($1, $2)`
  const params = [room, op]
  await pool.query(q, params)
}

export async function upsertAwarenessOperation(
  { room, client_id, op }: AwarenessOperation,
  pool: Pool
) {
  const q = `INSERT INTO ydoc_awareness (room, client_id, op, updated) VALUES ($1, $2, $3, now())
         ON CONFLICT (client_id, room) DO UPDATE SET op = $3, updated = now()`
  const params = [room, client_id, op]
  await pool.query(q, params)
}
