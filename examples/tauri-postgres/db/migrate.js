import fs from 'fs'
import path from 'path'
import * as url from 'url'
import { DATABASE_URL } from './util.js'

import createPool from '@databases/pg'
import { sql } from '@databases/pg'

// The __dirname variable is not available in ES modules.
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR || path.resolve(__dirname, 'migrations')

console.info(`Connecting to Postgres..`)
const db = createPool(DATABASE_URL)

const apply = async (fileName) => {
  const filePath = path.join(MIGRATIONS_DIR, fileName)
  console.log('Applying', filePath)

  await db.tx((tx) => tx.query(sql.file(filePath)))
}

const main = async () => {
  const fileNames = fs.readdirSync(MIGRATIONS_DIR)
  for (const file of fileNames) {
    if (path.extname(file) === '.sql') {
      await apply(file)
    }
  }
  console.log('⚡️ Database is migrated.')
}

try {
  main()
} catch (err) {
  console.error(err)
  process.exitCode = 1
} finally {
  db.dispose()
}
