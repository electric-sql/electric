import OriginalDatabase from '@tauri-apps/plugin-sql'

export type Database = Pick<OriginalDatabase, 'execute' | 'select'> & {
  // tauri does not expose the name of the DB
  // require the user to add it
  name: string
}

export async function createDatabase(name: string): Promise<Database> {
  const db = await OriginalDatabase.load(`sqlite:${name}`)
  Object.assign(db, { name })
  return db as typeof db & { name: string }
}
