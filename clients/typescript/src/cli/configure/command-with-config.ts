import { Command } from 'commander'
import { spawnSync } from 'child_process'
import { getConfig, envFromConfig, ConfigOptionName, Config } from '../config'

export function makeWithConfigCommand() {
  const command = new Command('with-config')
  command
    .description('Run a command with config arguments substituted')

    .arguments('<command>')

    .action(async (command) => {
      withConfig(command)
    })

  return command
}

export function withConfig(command: string, config?: Config) {
  const _config = config || getConfig()
  const env = process.env
  const re = /\{{([A-Z_]+)}}/g
  const cmd = command
    .replace(re, (match, envVar) => {
      const value = envVar.startsWith('ELECTRIC_')
        ? _config[envVar.slice('ELECTRIC_'.length) as ConfigOptionName] ||
          env[envVar]
        : env[envVar]
      if (value === undefined) {
        return match
      } else if (typeof value === 'string') {
        return value
      } else {
        return value.toString()
      }
    })
    .split(' ')

  return spawnSync(cmd[0], cmd.slice(1), {
    stdio: 'inherit',
    shell: true,
    env: {
      ...env,
      ...envFromConfig(_config),
    },
  })
}
