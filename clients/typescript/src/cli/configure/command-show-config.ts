import { Command } from 'commander'
import { getConfig } from '../config'

export function makeShowConfigCommand() {
  return new Command('show-config')
    .description('Show the current configuration')
    .action(showConfig)
}

export function showConfig() {
  const config = getConfig()
  console.log(config)
}
