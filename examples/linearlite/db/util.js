import fs from 'fs'
import path from 'path'
import shell from 'shelljs'
import * as url from 'url'

shell.config.silent = true // don't log output of child processes

// The __dirname variable is not available in ES modules.
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

// If we are running the docker compose file
// there will be a compose-postgres-1 container running
// which binds the container's 5432 port used by PG
// to some available port on the host machine.
// So we fetch this host port and use it in the default url.
export const pgPort = fetchHostPortPG() ?? 5432
export const appName = fetchAppName() ?? 'electric'
export const DEFAULT_URL = `postgresql://postgres:password@localhost:${pgPort}/${appName}`
export const DATABASE_URL = process.env.DATABASE_URL || DEFAULT_URL

export function fetchHostPortPG() {
  return fetchHostPort('compose-postgres-1', 5432)
}

// Returns the host port to which the `containerPort` of the `container` is bound.
// Returns undefined if the port is not bound or container does not exist.
function fetchHostPort(container, containerPort) {
  const output = shell.exec(
    `docker inspect --format='{{(index (index .NetworkSettings.Ports "${containerPort}/tcp") 0).HostPort}}' ${container}`
  )
  const port = parseInt(output)
  if (!isNaN(port)) {
    return port
  }
}

// Reads the app name from the backend/.envrc file
export function fetchAppName() {
  const envrcFile = path.join(__dirname, '..', 'backend', 'compose', '.envrc')
  const envrc = fs.readFileSync(envrcFile, 'utf8')

  let appName = undefined

  envrc
    .split(/\r?\n/) // split lines
    .reverse() // in case the app name would be defined several times
    .find((line) => {
      const match = line.match(/^(export APP_NAME=)(.*)/)
      if (match) {
        appName = match[2]
        return true
      }
      return false
    })

  return appName
}
