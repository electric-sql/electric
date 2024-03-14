import fs from 'fs/promises'
import { ElectricDatabase } from '../../src/drivers/node-postgres'
import { createEmbeddedPostgres } from '../../src/drivers/node-postgres/database';

export async function makePgDatabase(
  name: string,
  port: number
): Promise<{ db: ElectricDatabase; stop: () => Promise<void> }> {
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
