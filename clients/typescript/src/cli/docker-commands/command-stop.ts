import { Command } from 'commander'
import { dockerCompose } from './docker-utils'

type StopCommandArgs = {
  remove?: boolean
}

export function makeStopCommand() {
  const command = new Command('stop')
  command
    .description(
      'Stop the ElectricSQL sync service, and any optional PostgreSQL'
    )
    .option('-r --remove', 'Also remove the containers and volumes')
    .action(async (opts: StopCommandArgs) => {
      stop(opts)
    })
  return command
}

export function stop(opts: StopCommandArgs) {
  return new Promise<void>((resolve) => {
    const env = {
      COMPOSE_PROFILES: 'with-postgres', // Stop any PostgreSQL containers too
    }
    let proc
    if (opts.remove) {
      proc = dockerCompose('down', ['--volumes'], env)
    } else {
      proc = dockerCompose('stop', [], env)
    }
    proc.on('close', (code) => {
      if (code !== 0) {
        console.error('Failed to stop the ElectricSQL sync service.')
        process.exit(code ?? 1)
      } else {
        resolve()
      }
    })
  })
}
