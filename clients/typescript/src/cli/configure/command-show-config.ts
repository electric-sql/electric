import { Command } from 'commander'
import { getConfig, printConfig } from '../config'

export function makeShowConfigCommand() {
  return new Command('show-config')
    .description('Show the current configuration')
    .action(showConfig)
}

export function showConfig() {
  const config = getConfig()
  printConfig(config)
}
