const fs = require('fs')
const path = require('path')
const shell = require('shelljs')
shell.config.silent = true // don't log output of child processes

// If we are running the docker compose file
// there will be a compose-postgres-1 container running
// which binds the container's 5432 port used by PG
// to some available port on the host machine.
// So we fetch this host port and use it in the default url.
const appName = fetchAppName() ?? 'electric'
const pgPort = fetchHostPortPG() ?? 5432
const DEFAULT_URL = `postgresql://postgres:password@localhost:${pgPort}/${appName}`
const DATABASE_URL = process.env.DATABASE_URL || DEFAULT_URL
const PUBLIC_DATABASE_URL = DATABASE_URL.split('@')[1]

function error(err) {
  console.error('\x1b[31m', err, '\x1b[0m')
  process.exit(1)
}

function fetchHostPortPG() {
  return fetchHostPort(`${appName}-postgres-1`, 5432, 'Postgres')
}

function fetchHostPortElectric() {
  return fetchHostPort(`${appName}-electric-1`, 5133, 'Electric')
}

// Returns the host port to which the `containerPort` of the `container` is bound.
// Returns undefined if the port is not bound or container does not exist.
function fetchHostPort(container, containerPort, service) {
  const output = shell.exec(`docker inspect --format='{{(index (index .NetworkSettings.Ports "${containerPort}/tcp") 0).HostPort}}' ${container}`)
  if (output.code !== 0) {
    // Electric is not running for this app
    error(`${service} appears not to be running for this app.\nDocker container ${container} not running.`)
  }
  const port = parseInt(output)
  if (!isNaN(port)) {
    return port
  }
}

// Reads the app name from the backend/.envrc file
function fetchAppName() {
  const envrcFile = path.join(__dirname, '..', 'backend', 'compose', '.envrc')
  const envrc = fs.readFileSync(envrcFile, 'utf8')

  let appName = undefined

  envrc
  .split(/\r?\n/) // split lines
  .reverse() // in case the app name would be defined several times
  .find(line => {
    const match = line.match(/^(export APP_NAME=)(.*)/)
    if (match) {
      appName = match[2]
      return true
    }
    return false
  })

  return appName
}

exports.DATABASE_URL = DATABASE_URL
exports.PUBLIC_DATABASE_URL = PUBLIC_DATABASE_URL
exports.fetchHostPortElectric = fetchHostPortElectric
