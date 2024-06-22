import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

function composeFilePath(filename: string) {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'docker',
    filename
  )
}

function useExternalDockerNetwork(opt: string): string {
  if (opt === undefined || opt === null) return 'false'
  return (opt.length > 0).toString()
}

// Derive network name from the current working directory, matching Docker Compose's default
// naming.
function deriveNetworkName(opt: string): string {
  if (opt && opt.length > 0) return opt
  return path.basename(process.cwd()) + '_ip6net'
}

export function dockerCompose(
  command: string,
  userArgs: string[] = [],
  containerName?: string,
  env: { [key: string]: string } = {}
) {
  const composeFile = 'compose.yaml'
  const extraComposeFile =
    env.DOCKER_NETWORK_USE_EXTERNAL === 'host'
      ? 'compose.hostnet.yaml'
      : 'compose.ip6net.yaml'
  const args = [
    'compose',
    '--ansi',
    'always',
    '-f',
    composeFilePath(composeFile),
    '-f',
    composeFilePath(extraComposeFile),
    command,
    ...userArgs,
  ]
  return spawn('docker', args, {
    stdio: 'inherit',
    env: {
      ELECTRIC_COMPOSE_NETWORK_IS_EXTERNAL: useExternalDockerNetwork(
        env.DOCKER_NETWORK_USE_EXTERNAL
      ),
      ELECTRIC_COMPOSE_EXTERNAL_NETWORK_NAME: deriveNetworkName(
        env.DOCKER_NETWORK_USE_EXTERNAL
      ),
      ...process.env,
      ...(containerName ? { COMPOSE_PROJECT_NAME: containerName } : {}),
      ...env,
    },
  })
}

export function dockerComposeUp(
  userArgs: string[] = [],
  containerName?: string,
  env: { [key: string]: string } = {}
) {
  // We use the same compose.yaml file for `electric-sql start` and `electric-sql start
  // --with-postgres` and vary the services started by passing them as arguments to `docker
  // compose up`.
  const services =
    env.COMPOSE_PROFILES === 'with-postgres'
      ? ['postgres', 'electric']
      : ['electric']
  return dockerCompose('up', userArgs.concat(services), containerName, env)
}
