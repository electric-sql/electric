import { Command } from 'commander'
import { dockerCompose } from './docker-utils'

export function makeStatusCommand() {
  return new Command('status')
    .description(
      'Show status of the ElectricSQL sync service docker containers'
    )
    .action(status)
}

export function status() {
  dockerCompose('ps', [])
}
