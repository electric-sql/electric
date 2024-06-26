const { DATABASE_URL, PUBLIC_DATABASE_URL } = require(`./util.cjs`)
console.log({ DATABASE_URL, PUBLIC_DATABASE_URL })
const { spawn } = require(`child_process`)
const process = require(`process`)

console.info(`Connecting to proxy at ${PUBLIC_DATABASE_URL}`)

const args = [
  `pg-migrations`,
  `apply`,
  `--database`,
  DATABASE_URL,
  `--directory`,
  `./db/migrations`,
]
const proc = spawn(`npx`, args, {
  stdio: [`inherit`, `pipe`, `inherit`],
})

let newMigrationsApplied = true

proc.stdout.on(`data`, (data) => {
  if (data.toString().trim() === `No migrations required`) {
    newMigrationsApplied = false
  } else {
    process.stdout.write(data)
  }
})

proc.on(`exit`, (code) => {
  if (code === 0) {
    if (newMigrationsApplied) {
      console.log(`⚡️ Database migrated.`)
    } else {
      console.log(`⚡ Database already up to date.`)
    }
  } else {
    console.error(
      `\x1b[31m`,
      `Failed to connect to the DB. Exit code: ` + code,
      `\x1b[0m`
    )
  }
})
