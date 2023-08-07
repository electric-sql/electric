const shell = require('shelljs')

let db = undefined

if (process.argv.length === 4) {
  const command = process.argv[2]
  if (command !== '-db') {
    console.error(`Unsupported option ${command}. Only '-db' option is supported.`)
    process.exit(1)
  }

  const url = process.argv[3]
  db = url ?? process.env.DATABASE_URL
}
else if (process.argv.length !== 2) {
  // Wrong number of arguments
  console.log('Wrong number of arguments provided. Only one optional argument `-db <Postgres connection url>` is supported.')
}

if (db === undefined) {
  console.error(`Database URL is not provided. Please provide one using the DATABASE_URL environment variable.`)
  process.exit(1)
}

// TODO: test that electric:start still works :-)
//       --> with env var
//       --> and with -db arg
//       --> and uses db arg if both are provided
//       --> and complains otherwise
shell.env['DATABASE_URL'] = db
shell.exec('docker compose --env-file local-stack/.envrc -f local-stack/docker-compose-electric-only.yaml up')