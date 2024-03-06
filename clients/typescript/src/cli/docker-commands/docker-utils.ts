import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const composeFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'docker',
  'compose.yaml'
)

const composeFileWithPostgres = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'docker',
  'compose-with-postgres.yaml'
)

export function dockerCompose(
  command: string,
  userArgs: string[] = [],
  containerName?: string,
  env: { [key: string]: string } = {}
) {
  const withPostgres = env?.COMPOSE_PROFILES == 'with-postgres'
  const args = [
    'compose',
    '--ansi',
    'always',
    '-f',
    withPostgres ? composeFileWithPostgres : composeFile,
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
