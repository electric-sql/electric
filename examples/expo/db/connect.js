const { dockerCompose } = require('../util/util.js')
const { CONTAINER_DATABASE_URL, PUBLIC_DATABASE_URL } = require('./util.js')

console.info(`Connecting to proxy at ${PUBLIC_DATABASE_URL}`)

dockerCompose('exec', ['-it', 'postgres', 'psql', CONTAINER_DATABASE_URL])
