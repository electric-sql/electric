const { dockerCompose } = require('../util/util.cjs')
const { CONTAINER_DATABASE_URL, PUBLIC_DATABASE_URL } = require('./util.cjs')

console.info(`Connecting to proxy at ${PUBLIC_DATABASE_URL}`)

dockerCompose('exec', ['-it', 'postgres', 'psql', CONTAINER_DATABASE_URL])
