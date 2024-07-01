import fs from 'fs/promises'
import type { Database } from './database.js'
import { createEmbeddedPostgres } from './database.js'

export async function makePgDatabase(
  name: string,
  port: number
): Promise<{ db: Database; stop: () => Promise<void> }> {
  const { db, stop: stopPg } = await createEmbeddedPostgres({
    name,
    databaseDir: `./tmp-${name}`,
    persistent: false,
    port,
  })

  const stop = async () => {
    await stopPg()
    await fs.rm(`./tmp-${name}`, { recursive: true, force: true })
  }
  return { db, stop }
}
