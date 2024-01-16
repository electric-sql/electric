import { Command } from 'commander'
import {
  addOptionGroupToCommand,
  getConfig,
  GetConfigOptionsForGroup,
} from '../config'
import { buildDatabaseURL, parsePgProxyPort } from '../utils'
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

export function psql(opts: GetConfigOptionsForGroup<'proxy' | 'electric'>) {
  const config = getConfig(opts)
  // As we are connecting to the proxy from within the docker network, we have to
  // use the container name instead of localhost.
  const containerDbUrl = buildDatabaseURL({
    user: config.DATABASE_USER,
    password: config.PG_PROXY_PASSWORD,
    host: 'electric',
    port: parsePgProxyPort(config.PG_PROXY_PORT).port,
    dbName: config.DATABASE_NAME,
  })
  dockerCompose(
    'exec',
    ['-it', 'postgres', 'psql', containerDbUrl],
    config.CONTAINER_NAME
  )
}
