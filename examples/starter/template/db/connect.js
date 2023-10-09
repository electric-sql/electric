const { dockerCompose } = require('../util/util.js')
const { DATABASE_NAME, PUBLIC_DATABASE_URL } = require('./util.js')

console.info(`Connecting to postgres at ${PUBLIC_DATABASE_URL}`)

dockerCompose('exec', ['-it', 'postgres', 'psql', '-U', 'postgres', DATABASE_NAME])
