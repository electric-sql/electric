const shell = require('shelljs')

let db = process.env.DATABASE_URL

if (process.argv.length === 4) {
  const command = process.argv[2]
  if (command !== '-db') {
    console.error(`Unsupported option ${command}. Only '-db' option is supported.`)
    process.exit(1)
  }

  const url = process.argv[3]
  db = url
}
else if (process.argv.length !== 2) {
  // Wrong number of arguments
  console.log('Wrong number of arguments provided. Only one optional argument `-db <Postgres connection url>` is supported.')
}

if (db === undefined) {
  console.error(`Database URL is not provided. Please provide one using the DATABASE_URL environment variable.`)
  process.exit(1)
}

const electric = process.env.ELECTRIC_IMAGE ?? "electricsql/electric:latest"

shell.exec(`docker run \
-e "DATABASE_URL=${db}" \
-e "ELECTRIC_HOST=localhost" \
-e "LOGICAL_PUBLISHER_HOST=localhost" \
-e "AUTH_MODE=insecure" \
-p 5050:5050 \
-p 5133:5133 \
-p 5433:5433 ${electric}`)
