import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const composeFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'docker',
  'compose.yaml'
)

export function dockerCompose(
  command: string,
  userArgs: string[] = [],
  containerName?: string,
  env: { [key: string]: string } = {}
) {
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
      ...(containerName ? { COMPOSE_PROJECT_NAME: containerName } : {}),
      ...env,
    },
  })
}
