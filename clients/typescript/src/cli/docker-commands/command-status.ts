import { Command } from 'commander'
import { getConfig, Config } from '../config'
import { dockerCompose } from './docker-utils'

export function makeStatusCommand() {
  return new Command('status')
    .description(
      'Show status of the ElectricSQL sync service docker containers'
    )
    .action(async () => {
      const config = getConfig()
      status({ config })
    })
}

export function status({ config }: { config: Config }) {
  dockerCompose('ps', [], config.CONTAINER_NAME)
}
