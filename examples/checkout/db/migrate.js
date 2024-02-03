import dotenvFlow from 'dotenv-flow'
dotenvFlow.config()

import { spawn } from 'child_process'
import process from 'process'
import path from 'path'
import * as url from 'url'

const dirname = url.fileURLToPath(new URL('.', import.meta.url))

const PG_PROXY_URL = process.env.PG_PROXY_URL || 'postgres://postgres:proxy_password@localhost:65432/postgres'
const MIGRATIONS_DIR = path.resolve(dirname, 'migrations')

console.info(`Connecting to proxy at ${PG_PROXY_URL}`)

const args = ["run", "-s", "pg-migrations", "apply", "--database",  PG_PROXY_URL, "--directory", MIGRATIONS_DIR]
const proc = spawn("yarn", args, { cwd: dirname, stdio: ['inherit', 'pipe', 'inherit']  })

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
  } else {
     console.error(
      '\x1b[31m',
      'Failed to connect to the DB. Exit code: ' + code,
      '\x1b[0m'
    )
  }
})
