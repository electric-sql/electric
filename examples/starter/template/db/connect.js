const { DATABASE_URL, PUBLIC_DATABASE_URL } = require('./util.js')
const { spawn } = require('child_process')
console.info(`Connecting to postgres at ${PUBLIC_DATABASE_URL}`)
spawn(`psql ${DATABASE_URL}`, [], { cwd: __dirname, stdio: 'inherit', shell: true })