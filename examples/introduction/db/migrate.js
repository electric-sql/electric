const fs = require('fs')
const path = require('path')
const parseArgs = require('minimist')

const createPool = require('@databases/pg')
const { sql } = require('@databases/pg')

const DEFAULT_URL = 'postgresql://electric:password@intro.localhost:65432/electric'
const DATABASE_URL = process.env.DATABASE_URL || DEFAULT_URL
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || path.resolve(__dirname, 'migrations')

const argv = parseArgs(process.argv.slice(2))
const targetFile = argv.file

const db = createPool(DATABASE_URL)

const apply = async (fileName) => {
  const filePath = path.join(MIGRATIONS_DIR, fileName)
  console.log('apply', filePath)

  await db.tx(
    (tx) => tx.query(
      sql.file(filePath)
    )
  )
}

const main = async () => {
  if (targetFile !== undefined) {
    await apply(targetFile)
  }
  else {
    const fileNames = fs.readdirSync(MIGRATIONS_DIR)

    fileNames.forEach(async (file) => {
      await apply(file)
    })
  }
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
