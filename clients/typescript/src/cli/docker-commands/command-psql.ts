import { Command } from 'commander'
import {
  addOptionGroupToCommand,
  getConfig,
  GetConfigOptionsForGroup,
} from '../config'
import { getAppName, buildDatabaseURL } from '../utils'
import { dockerCompose } from './docker-utils'

export function makePsqlCommand() {
  const command = new Command('psql')
  command.description('Connect with psql to the ElectricSQL PostgreSQL proxy')

  addOptionGroupToCommand(command, 'proxy')

  command.action(async (opts) => {
    psql(opts)
  })

  return command
}

export function psql(opts: GetConfigOptionsForGroup<'proxy'>) {
  // TODO: Do we want a version of this that works without the postgres container
  // using a local psql client if available?
  const config = getConfig(opts)
  const appName = getAppName()
  const env = {
    ELECTRIC_APP_NAME: appName,
    COMPOSE_PROJECT_NAME: appName,
  }
  // As we are connecting to the proxy from within the docker network, we have to
  // use the container name instead of localhost.
  const containerDbUrl = buildDatabaseURL({
    user: config.DATABASE_USER,
    password: config.PG_PROXY_PASSWORD,
    host: 'electric',
    port: config.PG_PROXY_PORT,
    dbName: config.DATABASE_NAME,
  })
  dockerCompose('exec', ['-it', 'postgres', 'psql', containerDbUrl], env)
}
