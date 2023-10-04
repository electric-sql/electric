const { DATABASE_URL, PUBLIC_DATABASE_URL } = require('./util.js')
const { spawn } = require('child_process')
const process = require('process')

console.info(`Connecting to postgres at ${PUBLIC_DATABASE_URL}`)

const args = ["run", "-s", "pg-migrations", "apply", "--database",  DATABASE_URL, "--directory", "./db/migrations"]
const proc = spawn("yarn", args, { cwd: __dirname })

let newMigrationsApplied = true

proc.stdout.on('data', (data) => {
  if (data.toString().trim() === 'No migrations required') {
    newMigrationsApplied = false
  } else {
    process.stdout.write(data)
  }
})

proc.on('exit', (code) => {
  if (code === 0) {
    if (newMigrationsApplied) {
      console.log('⚡️ Database migrated.') 
    } else {
      console.log('⚡ Database already up to date.')
    }
  }
})
