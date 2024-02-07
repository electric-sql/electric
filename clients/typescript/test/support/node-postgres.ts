import fs from 'fs/promises'
import { ElectricDatabase } from '../../src/drivers/node-postgres'

export async function makePgDatabase(
  name: string,
  port: number
): Promise<{ db: ElectricDatabase; stop: () => Promise<void> }> {
  const db = await ElectricDatabase.init({
    name,
    databaseDir: `./tmp-${name}`,
    persistent: false,
    port,
  })

  const stop = async () => {
    await db.stop()
    await fs.rm(`./tmp-${name}`, { recursive: true, force: true })
  }
  return { db, stop }
}
