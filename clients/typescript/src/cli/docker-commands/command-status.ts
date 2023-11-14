import { Command } from 'commander'
import { dockerCompose } from './docker-utils'

export function makeStatusCommand() {
  const command = new Command('status')
  command
    .description(
      'Show status of the ElectricSQL sync service docker containers'
    )

    .action(async () => {
      status()
    })

  return command
}

export function status() {
  dockerCompose('ps', [])
}
