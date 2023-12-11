import { dockerCompose } from '../scripts/util.js'
import { CONTAINER_DATABASE_URL, PUBLIC_DATABASE_URL } from './util.js'

console.info(`Connecting to proxy at ${PUBLIC_DATABASE_URL}`)

dockerCompose('exec', ['-it', 'postgres', 'psql', CONTAINER_DATABASE_URL])
