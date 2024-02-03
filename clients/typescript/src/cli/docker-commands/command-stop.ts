import { Command } from 'commander'
import { dockerCompose } from './docker-utils'
import { getConfig, Config } from '../config'

type StopCommandArgs = {
  config: Config
  remove?: boolean
}

export function makeStopCommand() {
  return new Command('stop')
    .description(
      'Stop the ElectricSQL sync service, and any optional PostgreSQL'
    )
    .option('-r --remove', 'Also remove the containers and volumes')
    .action(async (opts: StopCommandArgs) => {
      stop({
        config: getConfig(),
        remove: opts.remove,
      })
    })
}

export function stop(opts: StopCommandArgs) {
  const config = opts.config
  return new Promise<void>((resolve) => {
    const env = {
      COMPOSE_PROFILES: 'with-postgres', // Stop any PostgreSQL containers too
    }
    let proc
    if (opts.remove) {
      proc = dockerCompose('down', ['--volumes'], config.CONTAINER_NAME, env)
    } else {
      proc = dockerCompose('stop', [], config.CONTAINER_NAME, env)
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
