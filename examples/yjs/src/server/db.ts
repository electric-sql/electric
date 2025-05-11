import { Pool } from "pg"

export type Update = {
  room: string
  update: Uint8Array
}

export type AwarenessUpdate = Update & {
  client_id: string
}

export async function saveUpdate({ room, update }: Update, pool: Pool) {
  const q = `INSERT INTO ydoc_update (room, update) VALUES ($1, $2)`
  const params = [room, update]
  await pool.query(q, params)
}

export async function upsertAwarenessUpdate(
  { room, client_id, update }: AwarenessUpdate,
  pool: Pool
) {
  const q = `INSERT INTO ydoc_awareness (room, client_id, update) VALUES ($1, $2, $3)
         ON CONFLICT (client_id, room) DO UPDATE SET update = $3, updated_at = now()`
  const params = [room, client_id, update]
  await pool.query(q, params)
}
