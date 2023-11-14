import { Command } from 'commander'
import { getConfig } from '../config'

export function makeShowConfigCommand() {
  const command = new Command('show-config')
  command
    .description('Show the current configuration')

    .action(async () => {
      showConfig()
    })

  return command
}

export function showConfig() {
  const config = getConfig()
  console.log(config)
}
