const fs = require('fs')
const path = require('path')
const { DATABASE_URL } = require('./util.js')

const createPool = require('@databases/pg')
const { sql } = require('@databases/pg')

const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || path.resolve(__dirname, 'migrations')

console.info(`Connecting to Postgres..`)
const db = createPool(DATABASE_URL)

const apply = async (fileName) => {
  const filePath = path.join(MIGRATIONS_DIR, fileName)
  console.log('Applying', filePath)

  await db.tx(
    (tx) => tx.query(
      sql.file(filePath)
    )
  )
}

const main = async () => {
  const fileNames = fs.readdirSync(MIGRATIONS_DIR)
  for (const file of fileNames) {
    if (path.extname(file) === '.sql') {
      await apply(file)
    }
  }
  console.log('⚡️ Database migrated.')
}

try {
  main()
}
catch (err) {
  console.error(err)
  process.exitCode = 1
}
finally {
  db.dispose()
}
