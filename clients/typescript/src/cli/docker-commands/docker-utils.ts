import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { getAppName } from '../utils'

const composeFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'docker',
  'compose.yaml'
)

export function dockerCompose(
  command: string,
  userArgs: string[] = [],
  env: { [key: string]: string } = {}
) {
  const appName = getAppName() ?? 'electric'
  const args = [
    'compose',
    '--ansi',
    'always',
    '-f',
    composeFile,
    command,
    ...userArgs,
  ]
  return spawn('docker', args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      APP_NAME: appName,
      COMPOSE_PROJECT_NAME: appName,
      ...env,
    },
  })
}
